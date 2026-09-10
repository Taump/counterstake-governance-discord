const DAG = require('aabot/dag.js');
const conf = require('ocore/conf.js');

const { checkObyteLeader } = require('./limits');
const { getTiming } = require('./timing');
const { formatUtc } = require('./embedText');
const getObyteValueKey = require('./obyteValueKey');
const {
	schedulePasses,
	resolveAlertDiscord,
	runPass,
	logLeaderCheck,
	reportUnsafeLeader,
} = require('./monitorSupport');
const getErrorMessage = require('../utils/getErrorMessage');

const CHAIN = 'Obyte';
const LOCK_KEY = 'LeaderAlertMonitor.Obyte';
const START_TS_PREFIX = 'challenging_period_start_ts_';
const MAX_LOGGED_VALUE_LENGTH = 200;

function formatSupport(support, decimals, symbol) {
	const amount = Number(support) || 0;
	return `${amount / (10 ** (Number(decimals) || 0))} ${symbol || 'tokens'}`;
}

// State var values are written by voters, so they are capped before reaching the logs.
function formatValue(value) {
	if (value === undefined || value === null) return 'not set (AA default)';
	const str = String(value);
	return str.length > MAX_LOGGED_VALUE_LENGTH ? str.slice(0, MAX_LOGGED_VALUE_LENGTH - 1) + '…' : str;
}

function exists(value) {
	return value !== undefined && value !== null;
}

class ObyteLeaderMonitor {
	#getGovernanceAAs;
	#getCounterstakeAAs;
	#injectedAlertDiscord;
	#scheduled = false;

	constructor({ getGovernanceAAs, getCounterstakeAAs, alertDiscord } = {}) {
		this.#getGovernanceAAs = getGovernanceAAs;
		this.#getCounterstakeAAs = getCounterstakeAAs;
		this.#injectedAlertDiscord = alertDiscord;
	}

	start() {
		if (this.#scheduled) return;
		this.#scheduled = true;
		schedulePasses({ chain: CHAIN, run: () => this.checkAll(), runNow: true });
	}

	// Timestamps come from the DAG rather than the local clock, to match what the AA sees.
	async #getNow() {
		try {
			const props = await DAG.getLastStableUnitProps();
			const timestamp = Number(props?.timestamp);
			if (Number.isFinite(timestamp) && timestamp > 0)
				return timestamp;
			console.error(`leader alert [${CHAIN}]: no timestamp in last stable unit props, using local clock`, props);
		} catch (e) {
			console.error(`leader alert [${CHAIN}]: failed to read last stable unit props, using local clock`, getErrorMessage(e));
		}
		return Math.floor(Date.now() / 1000);
	}

	checkAll() {
		let now = null;
		let aas = 0;
		return runPass({
			chain: CHAIN,
			lockKey: LOCK_KEY,
			skipIfLocked: true,
			context: () => `now=${now ?? '-'} aas=${aas}`,
			run: async (stats) => {
				now = await this.#getNow();
				const governanceAAs = this.#getGovernanceAAs() || {};
				console.error(`leader alert pass [${CHAIN}] start at ${formatUtc(now)}, ${Object.keys(governanceAAs).length} governance AAs`);
				for (const [address, governance] of Object.entries(governanceAAs)) {
					aas++;
					try {
						await this.#checkAA(address, governance, now, stats);
					} catch (e) {
						stats.errors++;
						console.error(`leader alert [${CHAIN}] error for governance AA ${address}:`, getErrorMessage(e));
					}
				}
				return true;
			},
		});
	}

	async #checkAA(address, governance, now, stats) {
		const startVars = await DAG.readAAStateVars(address, START_TS_PREFIX) || {};
		for (const [varName, rawStartTs] of Object.entries(startVars)) {
			if (!varName.startsWith(START_TS_PREFIX)) continue;
			const name = varName.slice(START_TS_PREFIX.length);
			const startTs = Number(rawStartTs);
			if (!startTs) {
				stats.notVoted++;
				continue;
			}
			await this.#checkLeader({ address, governance, name, startTs, now, stats });
		}
	}

	async #checkLeader({ address, governance, name, startTs, now, stats }) {
		const timing = getTiming({ startTs, period: governance.challenging_period, now });
		const leader = await DAG.readAAStateVar(address, 'leader_' + name);
		if (!exists(leader)) {
			stats.notVoted++;
			return;
		}
		// a missing current value means the parameter was never committed and the main AA
		// still runs on its default, so the leader is a pending change either way
		const current = await DAG.readAAStateVar(address, name);
		if (exists(current) && String(current) === String(leader)) {
			stats.committed++;
			return;
		}

		stats.checked++;
		if (!timing.halfPassed) stats.beforeHalf++;
		const verdict = checkObyteLeader(name, leader, { trustedOracle: conf.trusted_oracles?.[CHAIN] });
		const leaderValue = formatValue(leader);
		const currentValue = formatValue(current);
		const target = `${name}@${address}`;
		logLeaderCheck({ chain: CHAIN, target, leaderValue, currentValue, startTs, timing, verdict });
		if (verdict.safe) return;

		await reportUnsafeLeader({
			chain: CHAIN,
			target,
			alertDiscord: resolveAlertDiscord(this.#injectedAlertDiscord),
			stats,
			timing,
			leaderValue,
			reason: verdict.reason,
			buildAlert: async () => ({
				...await this.#getBridgeIdentity(address, governance, name, leader),
				name,
				leaderValue,
				currentValue,
				safeValue: verdict.safeValue,
				reason: verdict.reason,
				policy: verdict.policy,
				expiryTs: timing.expiryTs,
				canCommit: timing.canCommit,
				now,
			}),
		});
	}

	// The alert names the bridge AA, not the governance AA, so it matches the interface.
	async #getBridgeIdentity(address, governance, name, leader) {
		const supportKey = getObyteValueKey(leader, governance.is_import);
		const support = await DAG.readAAStateVar(address, `support_${name}_${supportKey}`);
		const main = (this.#getCounterstakeAAs() || {})[governance.main_aa] || {};
		const mainAddress = main.aa_address || governance.main_aa;
		return {
			aaName: `${mainAddress} - ${main.symbol} on ${CHAIN} (${governance.is_import ? 'import' : 'export'})`,
			url: conf.counterstake_base_url + mainAddress,
			leaderSupport: formatSupport(support, main.decimals, main.symbol),
		};
	}
}

module.exports = ObyteLeaderMonitor;
