const ARRAY_OUT_OF_BOUNDS_PANIC_CODE = 0x32n;

function isArrayOutOfBoundsError(error, index, method = 'leader', { allowEmptyOnGenericRevert = false } = {}) {
	const panicCode = error?.revert?.args?.[0];
	if (error?.revert?.name === 'Panic'
		&& panicCode !== undefined
		&& BigInt(panicCode) === ARRAY_OUT_OF_BOUNDS_PANIC_CODE) {
		return true;
	}
	if (index <= 0 && !allowEmptyOnGenericRevert) return false;
	if (error?.code !== 'CALL_EXCEPTION' || error?.action !== 'call') return false;
	if (error.data === '0x'
		&& error.reason === 'require(false)'
		&& error.invocation?.method === method
		&& error.invocation?.signature === `${method}(uint256)`) {
		return true;
	}

	const rpcError = error?.info?.error;
	return (error.data == null || error.data === '0x')
		&& error.reason == null
		&& error.revert == null
		&& rpcError?.code === 3
		&& /^execution reverted\.?$/i.test(rpcError.message?.trim() || '')
		&& (rpcError.data == null || rpcError.data === '0x');
}

function toPlainArray(value) {
	return Array.from(value || []);
}

function callWithOptions(contract, method, args, callOptions) {
	return callOptions
		? contract[method](...args, callOptions)
		: contract[method](...args);
}

class DataFetcher {
	static async fetchVotedData(contract, data, callOptions) {
		const leader_value = await callWithOptions(contract, 'leader', [], callOptions);
		const leader_support = await callWithOptions(contract, 'votesByValue', [leader_value], callOptions);
		let support = null;
		let value = null;
		if (data) {
			support = await callWithOptions(contract, 'votesByValue', [data.value], callOptions);
			value = data.value.toString();
		}
		return {
			leader_value: leader_value.toString(),
			leader_support,
			support,
			value,
		};
	}

	static async fetchVotedArrayData(contract, data, callOptions) {
		let leader_value = [];
		for (let i = 0; ; i++) {
			try {
				leader_value.push(await callWithOptions(contract, 'leader', [i], callOptions));
			} catch (e) {
				if (!isArrayOutOfBoundsError(e, i)) {
					throw e;
				}
				break;
			}
		}
		const leaderArray = toPlainArray(leader_value);
		const leaderKey = await callWithOptions(contract, 'getKey', [leaderArray], callOptions);
		const leader_support = await callWithOptions(contract, 'votesByValue', [leaderKey], callOptions);

		let support = null;
		let value = null;
		if (data) {
			const dataValue = toPlainArray(data.value);
			const dataKey = await callWithOptions(contract, 'getKey', [dataValue], callOptions);
			support = await callWithOptions(contract, 'votesByValue', [dataKey], callOptions);
			value = dataValue.map(v => Number(v));
		}

		return {
			leader_value: leaderArray.map(v => Number(v)),
			leader_support,
			support,
			value,
		};
	}

	// Raw readers for the leader alert monitor: values are kept as bigint / bigint[] /
	// address strings so that no precision is lost before validation and comparison.

	static async fetchRawUintArray(contract, method, options = {}) {
		const values = [];
		for (let i = 0; ; i++) {
			try {
				values.push(await contract[method](i));
			} catch (e) {
				if (!isArrayOutOfBoundsError(e, i, method, options)) {
					throw e;
				}
				break;
			}
		}
		return values.map(v => BigInt(v));
	}

	// `withSupport: false` skips the votes lookup, which is only needed to render an alert.
	static async fetchRawVotedState(contract, type, options = {}) {
		const { withSupport = true } = options;
		if (type === 'UintArray') {
			const leader = await DataFetcher.fetchRawUintArray(contract, 'leader', options);
			const current = await DataFetcher.fetchRawUintArray(contract, 'current_value', options);
			let support = null;
			if (withSupport) {
				const leaderKey = await contract.getKey(leader);
				support = BigInt(await contract.votesByValue(leaderKey));
			}
			return { leader, current, support };
		}

		const leader = await contract.leader();
		const current = await contract.current_value();
		const support = withSupport ? BigInt(await contract.votesByValue(leader)) : null;
		if (type === 'address') {
			return { leader: String(leader), current: String(current), support };
		}
		return { leader: BigInt(leader), current: BigInt(current), support };
	}

	static isSameValue(type, a, b) {
		if (type === 'UintArray') {
			if (a.length !== b.length) return false;
			return a.every((v, i) => BigInt(v) === BigInt(b[i]));
		}
		if (type === 'address') {
			return String(a).toLowerCase() === String(b).toLowerCase();
		}
		return BigInt(a) === BigInt(b);
	}
}

module.exports = DataFetcher;
