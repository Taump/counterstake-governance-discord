// Values are in seconds. `canCommit` follows the AA, which allows a commit at the expiry
// second; the contract wants one second more, and that second only affects wording.
function getTiming({ startTs, period, now }) {
	const expiryTs = startTs + period;
	return {
		expiryTs,
		remainingSeconds: Math.max(0, expiryTs - now),
		halfPassed: now >= startTs + period / 2,
		canCommit: now >= expiryTs,
	};
}

function formatUtc(timestamp) {
	return new Date(timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatDuration(seconds) {
	const total = Math.floor(seconds);
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
