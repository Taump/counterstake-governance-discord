const test = require('node:test');
const assert = require('node:assert/strict');
const { checkEvmLeader, checkObyteLeader } = require('../alerts/limits');

const TRUSTED_EVM = '0xAC4AA997A171A6CbbF5540D08537D5Cb1605E191';
const TRUSTED_OBYTE = 'JPQKPRI5FMTQRJF4ZZMYZYDQVRD55OTC';
const OTHER_OBYTE = 'FSA2UMYE7I3IMERTQDTFZTNTTKI2V75C';
const HOUR = 3600n;

function safe(result) {
	assert.equal(result.safe, true, JSON.stringify(result));
}

function unsafe(result, { policy = false, reason } = {}) {
	assert.equal(result.safe, false, JSON.stringify(result));
	assert.equal(result.policy, policy, JSON.stringify(result));
	assert.ok(result.safeValue, 'safe value text present');
	if (reason) assert.match(result.reason, reason);
}

test('EVM ratio100 must be within 10..1000', () => {
	unsafe(checkEvmLeader('ratio100', 5n));
	unsafe(checkEvmLeader('ratio100', 9n));
	safe(checkEvmLeader('ratio100', 10n));
	safe(checkEvmLeader('ratio100', 1000n));
	unsafe(checkEvmLeader('ratio100', 1001n));
	unsafe(checkEvmLeader('ratio100', 60000n));
});

test('EVM counterstake_coef100 must not exceed 1000', () => {
	safe(checkEvmLeader('counterstake_coef100', 101n));
	safe(checkEvmLeader('counterstake_coef100', 1000n));
	unsafe(checkEvmLeader('counterstake_coef100', 1001n));
	unsafe(checkEvmLeader('counterstake_coef100', 60000n));
});

test('EVM challenging periods must be at least 12 hours', () => {
	for (const name of ['challenging_periods', 'large_challenging_periods']) {
		unsafe(checkEvmLeader(name, [1n * HOUR, 3n * 24n * HOUR]), { reason: /shorter than 12 hours/ });
		unsafe(checkEvmLeader(name, [11n * HOUR]), { reason: /shorter than 12 hours/ });
		safe(checkEvmLeader(name, [12n * HOUR, 3n * 24n * HOUR]));
		safe(checkEvmLeader(name, [12n * HOUR, 12n * HOUR]));
		// the contract enforces the rest at vote time, so these can only be our own bug
		safe(checkEvmLeader(name, [3n * 365n * 24n * HOUR]));
		safe(checkEvmLeader(name, [3n * 24n * HOUR, 12n * HOUR]));
	}
});

test('EVM parameters the new contract does not tighten are always safe', () => {
	safe(checkEvmLeader('min_stake', 10n ** 30n));
	safe(checkEvmLeader('large_threshold', 0n));
	safe(checkEvmLeader('min_price20', 123n));
	safe(checkEvmLeader('min_tx_age', 4n * 7n * 24n * HOUR));
});

test('EVM oracleAddress policy', () => {
	safe(checkEvmLeader('oracleAddress', TRUSTED_EVM, { trustedOracle: TRUSTED_EVM }));
	safe(checkEvmLeader('oracleAddress', TRUSTED_EVM.toLowerCase(), { trustedOracle: TRUSTED_EVM }));
	unsafe(checkEvmLeader('oracleAddress', '0x250569a85537a6FC2C5Ac510F9662695BB2497f1', { trustedOracle: TRUSTED_EVM }), { policy: true });
	safe(checkEvmLeader('oracleAddress', '0x250569a85537a6FC2C5Ac510F9662695BB2497f1', {}));
});

test('Obyte ratio must be within 0.1..10', () => {
	unsafe(checkObyteLeader('ratio', 0.05));
	safe(checkObyteLeader('ratio', 0.1));
	safe(checkObyteLeader('ratio', '1.5'));
	safe(checkObyteLeader('ratio', 10));
	unsafe(checkObyteLeader('ratio', 10.5));
	unsafe(checkObyteLeader('ratio', 22));
});

test('Obyte counterstake_coef must not exceed 10', () => {
	safe(checkObyteLeader('counterstake_coef', 1.5));
	safe(checkObyteLeader('counterstake_coef', 10));
	unsafe(checkObyteLeader('counterstake_coef', 11));
});

test('Obyte parameters the new AA does not tighten are always safe', () => {
	safe(checkObyteLeader('min_stake', 0));
	safe(checkObyteLeader('min_tx_age', 45));
	safe(checkObyteLeader('large_threshold', 1000000000000));
	safe(checkObyteLeader('min_price', 0.5));
});

test('Obyte challenging periods must be at least 12 hours', () => {
	for (const name of ['challenging_periods', 'large_challenging_periods']) {
		unsafe(checkObyteLeader(name, '6 72'), { reason: /period 6h is shorter than 12 hours/ });
		unsafe(checkObyteLeader(name, '0.1 0.2 0.5 1'), { reason: /shorter than 12 hours/ });
		safe(checkObyteLeader(name, '12 72 168 720'));
		safe(checkObyteLeader(name, '12'));
		safe(checkObyteLeader(name, '26280'));
	}
});

test('Obyte oracles: trusted oracle and non-empty feed name', () => {
	const opts = { trustedOracle: TRUSTED_OBYTE };
	safe(checkObyteLeader('oracles', `${TRUSTED_OBYTE}*ETH_USD ${TRUSTED_OBYTE}/GBYTE_USD`, opts));
	unsafe(checkObyteLeader('oracles', `${OTHER_OBYTE}*ETH_USD`, opts), { policy: true, reason: /not the trusted oracle/ });
	safe(checkObyteLeader('oracles', `${OTHER_OBYTE}*ETH_USD`, {}));
	unsafe(checkObyteLeader('oracles', `${TRUSTED_OBYTE}*`, opts), { policy: true, reason: /empty feed name/ });
});

test('a value that is not a number is reported, so our own parsing bugs surface', () => {
	unsafe(checkEvmLeader('ratio100', 'abc'), { reason: /not a number/ });
	unsafe(checkEvmLeader('challenging_periods', 'not an array'), { reason: /not an array/ });
	unsafe(checkObyteLeader('ratio', 'abc'), { reason: /not a number/ });
	unsafe(checkObyteLeader('ratio', undefined), { reason: /not a number/ });
	unsafe(checkObyteLeader('challenging_periods', 'abc'), { reason: /not a number/ });
	unsafe(checkObyteLeader('challenging_periods', ''), { reason: /not a number/ });
});
