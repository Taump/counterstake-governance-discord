const { ethers } = require('ethers');
const getErrorMessage = require('../../utils/getErrorMessage');

const NATIVE_ASSETS = {
	Ethereum: { symbol: 'ETH', decimals: 18 },
	BSC: { symbol: 'BNB', decimals: 18 },
	Polygon: { symbol: 'MATIC', decimals: 18 },
	Kava: { symbol: 'KAVA', decimals: 18 },
};

const ERC20_METADATA_ABI = [
	'function symbol() view returns (string)',
	'function decimals() view returns (uint8)',
];

function normalizeMetadata(address, metadata) {
	const decimals = Number(metadata?.decimals);
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw Error(`invalid EVM asset decimals for ${address}: ${metadata?.decimals}`);
	}

	const rawSymbol = typeof metadata?.symbol === 'string' ? metadata.symbol.trim() : '';
	return {
		address,
		symbol: rawSymbol || address,
		decimals,
	};
}

class AssetMetadataResolver {
	#cache = new Map();

	resolve(network, address, provider, knownAssets = []) {
		const normalizedAddress = ethers.getAddress(address);
		const cacheKey = `${network}:${normalizedAddress.toLowerCase()}`;
		if (this.#cache.has(cacheKey)) {
			return this.#cache.get(cacheKey);
		}

		const pending = this.#load(network, normalizedAddress, provider, knownAssets)
			.catch(error => {
				this.#cache.delete(cacheKey);
				throw error;
			});
		this.#cache.set(cacheKey, pending);
		return pending;
	}

	async #load(network, address, provider, knownAssets) {
		for (const knownAsset of knownAssets) {
			if (!knownAsset?.address) continue;
			if (ethers.getAddress(knownAsset.address) === address) {
				return normalizeMetadata(address, knownAsset);
			}
		}

		if (address === ethers.ZeroAddress) {
			const nativeAsset = NATIVE_ASSETS[network];
			if (!nativeAsset) {
				throw Error(`native EVM asset metadata not found for ${network}`);
			}
			return normalizeMetadata(address, nativeAsset);
		}

		const token = new ethers.Contract(address, ERC20_METADATA_ABI, provider);
		const decimals = await token.decimals();
		let symbol;
		try {
			symbol = await token.symbol();
		} catch (error) {
			console.warn('failed to load EVM asset symbol, using address', {
				network,
				address,
				error: getErrorMessage(error),
			});
		}
		return normalizeMetadata(address, { symbol, decimals });
	}
}

module.exports = AssetMetadataResolver;
