// Off-chain replica of the safety limits that the NEW Counterstake contracts/AAs apply to
// governance values (byteball/counterstake-bridge commit e3ffff92 "limits on governable
// parameters"), plus bot policies (trusted oracles). Pure module: no I/O.
//
// A value that fails these checks is not invalid: the older deployed contracts/AAs accepted
// it, which is exactly why it is worth an alert. It is reported as unsafe.

const SECONDS_IN_HOUR = 3600;
const MIN_PERIOD_HOURS = 12;
const OBYTE_ADDRESS_LENGTH = 32;

const SAFE_VALUES = {
	ratio: '0.1 <= ratio <= 10',
	counterstake_coef: 'counterstake_coef <= 10',
	periods: 'each period >= 12 hours',
	feed_name: 'a non-empty feed name for every oracle',
};

const safe = () => ({ safe: true });
const unsafe = (reason, safeValue) => ({ safe: false, reason, safeValue });
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


function checkRatio(value) {
	return value >= 0.1 && value <= 10
		? safe()
		: unsafe(`ratio ${value} is outside the safe range`, SAFE_VALUES.ratio);
}

function checkCounterstakeCoef(value) {
	return Number.isFinite(value) && value <= 10
		? safe()
		: unsafe(`counterstake_coef ${value} is above the safe maximum`, SAFE_VALUES.counterstake_coef);
}

function checkPeriods(hours) {
	for (const period of hours) {
		if (!(period >= MIN_PERIOD_HOURS))
			return unsafe(`period ${period}h is shorter than 12 hours`, SAFE_VALUES.periods);
	}
	return safe();
}

function checkTrustedOracle(oracle, trustedOracle) {
	if (!trustedOracle) return safe(); // no oracle configured for this network: policy is off
	return String(oracle).toLowerCase() === trustedOracle.toLowerCase()
		? safe()
		: unsafe(`oracle ${oracle} is not the trusted oracle`, trustedOracleValue(trustedOracle));
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
			return checkPeriods(rawValue.map(toHours));
		case 'oracleAddress':
			return checkTrustedOracle(rawValue, trustedOracle);
		default:
			return safe();
	}
}

function checkObyteOracles(rawValue, trustedOracle) {
	for (const pair of String(rawValue).split(' ')) {
		const oracle = pair.slice(0, OBYTE_ADDRESS_LENGTH);
		if (!pair.slice(OBYTE_ADDRESS_LENGTH + 1)) // the AA allows an empty feed name; this is bot policy
			return unsafe(`empty feed name for oracle ${oracle}`, SAFE_VALUES.feed_name);

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
		case 'challenging_periods':
		case 'large_challenging_periods':
			return checkPeriods(String(rawValue).split(' ').map(toNumber));
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
