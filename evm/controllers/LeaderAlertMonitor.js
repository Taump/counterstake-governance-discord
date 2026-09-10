const { ethers } = require('ethers');
const conf = require('ocore/conf');

const { getAbiByType } = require('../abi/getAbiByType');
const DataFetcher = require('./DataFetcher');
const Formatter = require('./Formatter');
const Discord = require('./Discord');
const { checkEvmLeader } = require('../../alerts/limits');
const { getTiming, formatUtc } = require('../../alerts/timing');
const {
	schedulePasses,
	resolveAlertDiscord,
	runPass,
	logLeaderCheck,
	reportUnsafeLeader,
} = require('../../alerts/monitorSupport');
const sleep = require('../../utils/sleep');
const getErrorMessage = require('../../utils/getErrorMessage');

const LOCK_PREFIX = 'LeaderAlertMonitor';
const CONTRACT_DELAY_SECONDS = 0.3;
const READ_ATTEMPTS = 5;
const READ_RETRY_SECONDS = 2;

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
		this.#contracts[network] = (contracts || []).filter(contract => contract.type !== 'governance'); // holds no voted value
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
					await this.#readContract(network, contract, Number(block.timestamp), stats);
					await sleep(CONTRACT_DELAY_SECONDS);
				}
				return true;
			},
		});
	}

	// Like the event scanner: a read is retried, and one that keeps failing crashes the pass
	// rather than leaving contracts silently unchecked. The daemon check restarts the bot.
	async #readContract(network, contract, blockTs, stats) {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.#checkContract(network, contract, blockTs, stats);
			} catch (e) {
				const target = `${contract.name}@${contract.address}`;
				if (attempt === READ_ATTEMPTS)
					throw Error(`${target} unreadable after ${READ_ATTEMPTS} attempts: ${getErrorMessage(e)}`);
				console.error(`leader alert [${network}] read attempt ${attempt}/${READ_ATTEMPTS} failed for ${target}: ${getErrorMessage(e)}`);
				await sleep(READ_RETRY_SECONDS);
			}
		}
	}

	async #checkContract(network, contract, blockTs, stats) {
		const { type, name, address, meta } = contract;
		const c = new ethers.Contract(address, getAbiByType(type), this.#providers[network]);

		const startTs = Number(await c.challenging_period_start_ts());
		if (!startTs) {
			stats.notVoted++;
			return;
		}

		const timing = getTiming({ startTs, period: meta.challenging_period, now: blockTs });

		// challenging_period_start_ts() just succeeded on this contract, so a bare revert on
		// leader(0)/current_value(0) means an empty array
		const { leader, current, support } = await DataFetcher.fetchRawVotedState(c, type, {
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
