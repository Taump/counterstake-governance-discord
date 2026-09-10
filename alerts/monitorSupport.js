const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex');

const AlertDiscord = require('./AlertDiscord');
const { formatUtc } = require('./embedText');
const { formatDuration } = require('./timing');
const getErrorMessage = require('../utils/getErrorMessage');
const crashOnError = require('../utils/crashOnError');

// Shared by both leader monitors. Alert output goes through console.error on purpose:
// headless-obyte redirects console.log, warn and info to log.txt.

function schedulePasses({ chain, run, runNow = false }) {
	const intervalHours = conf.alert_check_interval_hours;
	const start = label => run().catch(e => crashOnError(`leader alert ${label} failed`, e));
	if (runNow) start(`initial ${chain} pass`);
	setInterval(() => start(`${chain} interval`), intervalHours * 60 * 60 * 1000);
	console.error(`leader alert monitor [${chain}]: checking every ${intervalHours} hours`);
}

function resolveAlertDiscord(injected) {
	return injected || AlertDiscord.getInstance();
}

function newPassStats() {
	return {
		checked: 0,
		notVoted: 0,
		beforeHalf: 0,
		committed: 0,
		unsafe: 0,
		unsafeBeforeHalf: 0,
		alertsSent: 0,
		errors: 0,
	};
}

function formatPassStats(stats, startedAt) {
	return `checked=${stats.checked} notVoted=${stats.notVoted} beforeHalf=${stats.beforeHalf}`
		+ ` committed=${stats.committed} unsafe=${stats.unsafe} unsafeBeforeHalf=${stats.unsafeBeforeHalf}`
		+ ` alertsSent=${stats.alertsSent} errors=${stats.errors} durationMs=${Date.now() - startedAt}`;
}

// `context` is read at the end, so it can report state the pass discovered
async function runPass({ chain, lockKey, skipIfLocked = false, context = () => '', run }) {
	const unlock = skipIfLocked ? await mutex.lockOrSkip(lockKey) : await mutex.lock(lockKey);
	if (!unlock) {
		console.error(`leader alert pass [${chain}] skipped, already running`);
		return false;
	}

	const startedAt = Date.now();
	const stats = newPassStats();
	try {
		return await run(stats);
	} catch (e) {
		stats.errors++;
		console.error(`leader alert pass [${chain}] failed:`, getErrorMessage(e));
		return false;
	} finally {
		console.error(`leader alert pass [${chain}] ${context()} ${formatPassStats(stats, startedAt)}`);
		unlock();
	}
}

function logLeaderCheck({ chain, target, leaderValue, currentValue, startTs, timing, verdict }) {
	console.error(`leader alert check [${chain}] ${target} leader=${leaderValue} current=${currentValue}`
		+ ` startTs=${startTs} halfPassed=${timing.halfPassed} canCommit=${timing.canCommit}`
		+ ` verdict=${verdict.safe ? 'safe' : 'UNSAFE: ' + verdict.reason}`);
}

// Before half of the challenging period the value is only logged, and the alert follows on a
// later pass. `buildAlert` runs only when alerting, so its extra chain reads are skipped.
async function reportUnsafeLeader({ chain, target, alertDiscord, stats, timing, leaderValue, reason, buildAlert }) {
	stats.unsafe++;
	if (!timing.halfPassed) {
		stats.unsafeBeforeHalf++;
		console.error(`leader alert [${chain}] unsafe leader value, too early to alert: ${target}`
			+ ` value=${leaderValue} (${reason}); challenging period still runs for`
			+ ` ${formatDuration(timing.remainingSeconds)}, until ${formatUtc(timing.expiryTs)}`);
		return false;
	}

	await alertDiscord.announceUnsafeLeader(await buildAlert());
	stats.alertsSent++;
	return true;
}

module.exports = {
	schedulePasses,
	resolveAlertDiscord,
	newPassStats,
	formatPassStats,
	runPass,
	logLeaderCheck,
	reportUnsafeLeader,
};
