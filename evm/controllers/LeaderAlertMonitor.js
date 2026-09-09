const { ethers } = require('ethers');
const conf = require('ocore/conf');

const { getAbiByType } = require('../abi/getAbiByType');
const DataFetcher = require('./DataFetcher');
const Formatter = require('./Formatter');
const Discord = require('./Discord');
const { checkEvmLeader } = require('../../alerts/limits');
const { getEvmTiming } = require('../../alerts/timing');
const { formatUtc } = require('../../alerts/embedText');
const {
	schedulePasses,
	resolveAlertDiscord,
	runPass,
	logLeaderCheck,
	reportUnsafeLeader,
} = require('../../alerts/monitorSupport');
const getErrorMessage = require('../../utils/getErrorMessage');
const sleep = require('../../utils/sleep');

const LOCK_PREFIX = 'LeaderAlertMonitor';
const CONTRACT_DELAY_SECONDS = 0.3;
const SKIPPED_TYPES = ['governance']; // the governance contract itself holds no voted value

// A pass pins all its reads to one block. If that block is no longer available on the node
// (a pruning or load-balanced RPC), the pass refetches the head and retries the contract.
const STATE_UNAVAILABLE = /historical state|missing trie node|header not found|unknown block|block not found/i;

function isStateUnavailableError(error) {
	const message = [error?.message, error?.shortMessage, error?.info?.error?.message, error?.error?.message];
	return STATE_UNAVAILABLE.test(message.filter(Boolean).join(' '));
}

function formatValue(name, value, meta) {
	const formatted = String(Formatter.format(name, value, meta));
	return formatted === '' ? '(empty)' : formatted;
}

class LeaderAlertMonitor {
	#contracts = {};
	#providers = {};
	#injectedAlertDiscord;
	#scheduled = false;
	#startupCheckedNetworks = new Set();
	#startupPasses = {};

	constructor({ alertDiscord } = {}) {
		this.#injectedAlertDiscord = alertDiscord;
	}

	setProvider(network, provider) {
		this.#providers[network] = provider;
	}

	setContracts(network, contracts) {
		this.#contracts[network] = (contracts || []).filter(contract => !SKIPPED_TYPES.includes(contract.type));
	}

	startInterval() {
		if (this.#scheduled) return;
		this.#scheduled = true;
		schedulePasses({ chain: 'EVM', run: () => this.checkAllNetworks() });
	}

	checkAllNetworks() {
		const networks = Object.keys(this.#contracts).filter(network => this.#contracts[network]?.length);
		return Promise.all(networks.map(network => this.#checkNetwork(network, { skipIfLocked: true })));
	}

	// Only a completed pass counts, so a failed one is retried on the next reconnect. A
	// flapping provider reconnects every couple of seconds, so passes are deduplicated and
	// skipped rather than queued: a reconnect storm must not pile them up.
	checkNetworkOnce(network) {
		if (this.#startupCheckedNetworks.has(network)) return Promise.resolve(false);
		if (!this.#startupPasses[network]) {
			this.#startupPasses[network] = this.#checkNetwork(network, { skipIfLocked: true })
				.then((done) => {
					if (done) this.#startupCheckedNetworks.add(network);
					return done;
				})
				.finally(() => { delete this.#startupPasses[network]; });
		}
		return this.#startupPasses[network];
	}

	async #getLatestBlock(network) {
		const provider = this.#providers[network];
		if (!provider) throw Error(`no provider for ${network}`);
		const block = await provider.getBlock('latest');
		if (!block) throw Error(`latest block not found for ${network}`);
		return block;
	}

	async #checkNetwork(network, { skipIfLocked = false } = {}) {
		const contracts = this.#contracts[network] || [];
		if (!contracts.length) return false; // nothing to check, and nothing worth logging

		let block = null;
		return runPass({
			chain: network,
			lockKey: `${LOCK_PREFIX}.${network}`,
			skipIfLocked,
			context: () => `block=${block ? block.number : '-'}`,
			run: async (stats) => {
				block = await this.#getLatestBlock(network);
				console.error(`leader alert pass [${network}] start at block ${block.number} (${formatUtc(block.timestamp)}), ${contracts.length} contracts`);

				for (const contract of contracts) {
					block = await this.#checkContractWithRetry(network, contract, block, stats);
					await sleep(CONTRACT_DELAY_SECONDS);
				}
				return true;
			},
		});
	}

	// Returns the block the pass should keep using: a fresher head if the pinned one went away
	async #checkContractWithRetry(network, contract, block, stats) {
		for (let attempt = 1; ; attempt++) {
			try {
				await this.#checkContract(network, contract, block, stats);
				return block;
			} catch (e) {
				if (isStateUnavailableError(e) && attempt === 1) {
					console.error(`leader alert [${network}] state unavailable at block ${block.number}, refetching latest block`, getErrorMessage(e));
					block = await this.#getLatestBlock(network);
					continue;
				}
				stats.errors++;
				console.error(`leader alert [${network}] error for ${contract.name}@${contract.address}:`, getErrorMessage(e));
				return block;
			}
		}
	}

	async #checkContract(network, contract, block, stats) {
		const { type, name, address, meta } = contract;
		const blockTs = Number(block.timestamp);
		const callOptions = { blockTag: block.number };
		const c = new ethers.Contract(address, getAbiByType(type), this.#providers[network]);

		const startTs = Number(await c.challenging_period_start_ts(callOptions));
		if (!startTs) {
			stats.notVoted++;
			return;
		}

		const timing = getEvmTiming({ startTs, period: meta.challenging_period, blockTs });

		// challenging_period_start_ts() just succeeded on this contract at this block, so a
		// bare revert on leader(0)/current_value(0) means an empty array
		const { leader, current, support } = await DataFetcher.fetchRawVotedState(c, type, callOptions, {
			allowEmptyOnGenericRevert: true,
			withSupport: timing.halfPassed,
		});
		if (DataFetcher.isSameValue(type, leader, current)) {
			stats.committed++;
			return;
		}

		stats.checked++;
		if (!timing.halfPassed) stats.beforeHalf++;
		const verdict = checkEvmLeader(name, leader, { trustedOracle: conf.trusted_oracles?.[network] });
		const leaderValue = formatValue(name, leader, meta);
		const currentValue = formatValue(name, current, meta);
		const target = `${name}@${address}`;
		logLeaderCheck({ chain: network, target, leaderValue, currentValue, startTs, timing, verdict });
		if (verdict.safe) return;

		await reportUnsafeLeader({
			chain: network,
			target,
			alertDiscord: resolveAlertDiscord(this.#injectedAlertDiscord),
			stats,
			timing,
			leaderValue,
			reason: verdict.reason,
			buildAlert: () => ({
				aaName: Discord.getAaName(meta),
				url: Discord.getInterfaceUrl(meta),
				name,
				leaderValue,
				currentValue,
				safeValue: verdict.safeValue,
				reason: verdict.reason,
				policy: verdict.policy,
				leaderSupport: `${ethers.formatUnits(support, meta.votingAsset.decimals)} ${meta.votingAsset.symbol}`,
				expiryTs: timing.expiryTs,
				canCommit: timing.canCommit,
				now: blockTs,
			}),
		});
	}
}

module.exports = LeaderAlertMonitor;
