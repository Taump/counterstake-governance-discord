// Challenging-period timing, computed separately per platform because the commit
// boundary differs:
//  - EVM VotedValue.checkChallengingPeriodExpiry(): block.timestamp > start + period (strict)
//  - Obyte governance AA: bounces only while start + period > timestamp, i.e. commit is
//    allowed when timestamp >= start + period (inclusive)

function getTiming({ startTs, period, now }, commitIsStrict) {
	const start = Number(startTs);
	const challengingPeriod = Number(period);
	const ts = Number(now);
	const halfTs = start + challengingPeriod / 2;
	const expiryTs = start + challengingPeriod;
	return {
		halfTs,
		expiryTs,
		remainingSeconds: Math.max(0, expiryTs - ts),
		halfPassed: ts >= halfTs,
		canCommit: commitIsStrict ? ts > expiryTs : ts >= expiryTs,
	};
}

function formatDuration(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	if (days) return `${days}d ${hours}h`;
	if (hours) return `${hours}h ${minutes}m`;
	if (minutes) return `${minutes}m`;
	return `${total}s`;
}

function getEvmTiming({ startTs, period, blockTs }) {
	return getTiming({ startTs, period, now: blockTs }, true);
}

function getObyteTiming({ startTs, period, now }) {
	return getTiming({ startTs, period, now }, false);
}

module.exports = {
	getEvmTiming,
	getObyteTiming,
	formatDuration,
};
