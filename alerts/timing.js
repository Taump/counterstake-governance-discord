// Values are in seconds. `canCommit` follows the AA, which allows a commit at the expiry
// second; the contract wants one second more, and that second only affects wording.
function getTiming({ startTs, period, now }) {
	const start = Number(startTs);
	const expiryTs = start + Number(period);
	const ts = Number(now);
	return {
		expiryTs,
		remainingSeconds: Math.max(0, expiryTs - ts),
		halfPassed: ts >= start + Number(period) / 2,
		canCommit: ts >= expiryTs,
	};
}

function formatUtc(timestamp) {
	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || ts <= 0) return 'unknown';
	return new Date(Math.floor(ts) * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
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

module.exports = {
	getTiming,
	formatUtc,
	formatDuration,
};
