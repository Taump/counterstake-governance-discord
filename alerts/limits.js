// Off-chain replica of the safety limits that the NEW Counterstake contracts/AAs apply to
// governance values (byteball/counterstake-bridge commit e3ffff92 "limits on governable
// parameters"), plus bot policies (trusted oracles). Pure module: no I/O.
//
// A value that fails these checks is not invalid: the older deployed contracts/AAs accepted
// it, which is exactly why it is worth an alert. It is reported as unsafe.
const { isValidAddress: isValidObyteAddress } = require('ocore/validation_utils.js');

const SECONDS_IN_HOUR = 3600;
const MIN_PERIOD_HOURS = 12;
const MAX_PERIOD_HOURS = 3 * 365 * 24;
const MAX_MIN_TX_AGE_SECONDS = 4 * 7 * 24 * SECONDS_IN_HOUR;
const MAX_OBYTE_PERIODS = 20;
const MAX_OBYTE_ORACLES = 3;
const OBYTE_ADDRESS_LENGTH = 32;

const SAFE_VALUES = {
	ratio: '0.1 <= ratio <= 10',
	counterstake_coef: '1 < counterstake_coef <= 10',
	// The other period rules (non-empty, at most 20, at most 3 years, non-decreasing) were
	// already enforced by the older deployed contracts and AAs, so a leader can never break
	// them and there is no point naming them here. They are still checked, defensively.
	periods: 'each period >= 12 hours',
	min_tx_age: 'min_tx_age < 4 weeks',
	non_negative_integer: 'integer >= 0',
	non_negative_number: 'number >= 0',
	oracles: 'up to 3 pairs "<oracle>*<feed>" or "<oracle>/<feed>" with a valid oracle address',
};

const safe = () => ({ safe: true, reason: null, safeValue: null, policy: false });
const unsafe = (reason, safeValue, policy = false) => ({ safe: false, reason, safeValue, policy });
const trustedOracleValue = oracle => `trusted oracle ${oracle}`;

function toNumber(value) {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

const toHours = value => {
	const seconds = toNumber(value);
	return seconds === null ? null : seconds / SECONDS_IN_HOUR;
};

function checkRange(label, value, { min, max, minExclusive, maxExclusive, safeValue }) {
	if (value === null)
		return unsafe(`${label} is not a number`, safeValue);
	const aboveMin = minExclusive ? value > min : value >= min;
	const belowMax = maxExclusive ? value < max : value <= max;
	return aboveMin && belowMax
		? safe()
		: unsafe(`${label} ${value} is outside the safe range`, safeValue);
}

// `maxCount` and `maxExclusive` are the only differences between the chains: the AA caps the
// list at 20 entries, and the contract rejects exactly 3 years while the AA allows it.
function checkPeriods(hours, { maxCount = Infinity, maxExclusive = false } = {}) {
	if (!hours.length)
		return unsafe('empty periods', SAFE_VALUES.periods);
	if (hours.length > maxCount)
		return unsafe('too many periods', SAFE_VALUES.periods);

	let previous = 0;
	for (const period of hours) {
		if (period === null)
			return unsafe('period is not a number', SAFE_VALUES.periods);
		if (period < MIN_PERIOD_HOURS)
			return unsafe(`period ${period}h is shorter than 12 hours`, SAFE_VALUES.periods);
		if (maxExclusive ? period >= MAX_PERIOD_HOURS : period > MAX_PERIOD_HOURS)
			return unsafe(`period ${period}h is longer than 3 years`, SAFE_VALUES.periods);
		if (period < previous)
			return unsafe('subsequent periods cannot get shorter', SAFE_VALUES.periods);
		previous = period;
	}
	return safe();
}

function checkNonNegative(name, rawValue, mustBeInteger) {
	const value = toNumber(rawValue);
	const isSafe = value !== null && value >= 0 && (!mustBeInteger || Number.isInteger(value));
	return isSafe ? safe() : unsafe(
		`${name} ${String(rawValue)} is not a non-negative ${mustBeInteger ? 'integer' : 'number'}`,
		mustBeInteger ? SAFE_VALUES.non_negative_integer : SAFE_VALUES.non_negative_number,
	);
}

const checkRatio = value => checkRange('ratio', value, { min: 0.1, max: 10, safeValue: SAFE_VALUES.ratio });

const checkCounterstakeCoef = value => checkRange('counterstake_coef', value,
	{ min: 1, minExclusive: true, max: 10, safeValue: SAFE_VALUES.counterstake_coef });

function checkTrustedOracle(oracle, trustedOracle, normalize = value => value) {
	if (!trustedOracle) return safe(); // no oracle configured for this network: policy is off
	return normalize(String(oracle)) === normalize(trustedOracle)
		? safe()
		: unsafe(`oracle ${oracle} is not the trusted oracle`, trustedOracleValue(trustedOracle), true);
}

function checkEvmLeader(name, rawValue, { trustedOracle } = {}) {
	const hundredths = value => (value === null ? null : value / 100);
	switch (name) {
		case 'ratio100':
			return checkRatio(hundredths(toNumber(rawValue)));
		case 'counterstake_coef100':
			return checkCounterstakeCoef(hundredths(toNumber(rawValue)));
		case 'challenging_periods':
		case 'large_challenging_periods':
			return Array.isArray(rawValue)
				? checkPeriods(rawValue.map(toHours), { maxExclusive: true })
				: unsafe('periods is not an array', SAFE_VALUES.periods);
		case 'min_tx_age':
			return checkRange('min_tx_age', toNumber(rawValue),
				{ min: 0, max: MAX_MIN_TX_AGE_SECONDS, maxExclusive: true, safeValue: SAFE_VALUES.min_tx_age });
		case 'oracleAddress':
			return checkTrustedOracle(rawValue, trustedOracle, value => value.toLowerCase());
		default:
			return safe();
	}
}

function checkObyteOracles(rawValue, trustedOracle) {
	const pairs = String(rawValue).split(' ');
	if (pairs.length > MAX_OBYTE_ORACLES)
		return unsafe('too many oracles', SAFE_VALUES.oracles);

	for (const pair of pairs) {
		const oracle = pair.slice(0, OBYTE_ADDRESS_LENGTH);
		const operator = pair.slice(OBYTE_ADDRESS_LENGTH, OBYTE_ADDRESS_LENGTH + 1);
		const feedName = pair.slice(OBYTE_ADDRESS_LENGTH + 1);
		if (!isValidObyteAddress(oracle))
			return unsafe(`bad oracle address: ${oracle}`, SAFE_VALUES.oracles);
		if (operator !== '*' && operator !== '/')
			return unsafe('bad format of oracles, should be oracle*feed_name or oracle/feed_name', SAFE_VALUES.oracles);
		if (!feedName) // the AA itself does not forbid an empty feed name; this is bot policy
			return unsafe(`empty feed name for oracle ${oracle}`, SAFE_VALUES.oracles, true);

		const trusted = checkTrustedOracle(oracle, trustedOracle);
		if (!trusted.safe) return trusted;
	}
	return safe();
}

function checkObyteLeader(name, rawValue, { trustedOracle } = {}) {
	switch (name) {
		case 'ratio':
			return checkRatio(toNumber(rawValue));
		case 'counterstake_coef':
			return checkCounterstakeCoef(toNumber(rawValue));
		case 'min_stake':
		case 'min_tx_age':
		case 'large_threshold':
			return checkNonNegative(name, rawValue, true);
		case 'min_price':
			return checkNonNegative(name, rawValue, false);
		case 'challenging_periods':
		case 'large_challenging_periods':
			return checkPeriods(String(rawValue).split(' ').map(toNumber), { maxCount: MAX_OBYTE_PERIODS });
		case 'oracles':
			return checkObyteOracles(rawValue, trustedOracle);
		default:
			return safe();
	}
}

module.exports = {
	checkEvmLeader,
	checkObyteLeader,
};
