const { ethers } = require('ethers');
const { isValidAddress: isValidObyteAddress } = require('ocore/validation_utils.js');

const OBYTE = 'Obyte';

// Throws rather than returning a flag: callers validate configuration, where a bad value
// must stop the process. EVM addresses come back in checksum case.
function validateAddressByNetwork(network, address, label = 'address') {
	if (network === OBYTE) {
		if (!isValidObyteAddress(address))
			throw Error(`invalid ${label} on ${network}: ${address}`);
		return address;
	}
	try {
		return ethers.getAddress(address);
	} catch (e) {
		throw Error(`invalid ${label} on ${network}: ${address}`);
	}
}

function validateAddressesByNetwork(addressesByNetwork = {}, label = 'address') {
	for (const [network, address] of Object.entries(addressesByNetwork)) {
		addressesByNetwork[network] = validateAddressByNetwork(network, address, label);
	}
	return addressesByNetwork;
}

module.exports = {
	validateAddressByNetwork,
	validateAddressesByNetwork,
};
