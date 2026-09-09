const { ethers } = require('ethers');
const conf = require('../../conf');
const governanceDiscord = require("governance_events/governance_discord");

const {
	getLinkToExplorerByTX
} = require("../../utils/getLinkToExplorer");

function normalizeTriggerAddress(event) {
	if (event.trigger_address === null || event.trigger_address === undefined)
		return;
	try {
		event.trigger_address = ethers.getAddress(event.trigger_address);
	} catch (e) {
		console.log('invalid EVM trigger address, keeping original value', event.trigger_address);
	}
}

class Discord {
	static getAaName(meta) {
		return meta.main_aa + ' - ' + meta.bridgeAsset.symbol + ' on ' + meta.network + ' (' + (meta.isImport ? 'import' : 'export') + ')';
	}

	static getInterfaceUrl(meta) {
		return conf.counterstake_base_url + meta.main_aa;
	}

	static announceEvent(meta, event) {
		normalizeTriggerAddress(event);

		return governanceDiscord.announceEvent(
			Discord.getAaName(meta),
			meta.votingAsset.symbol,
			meta.votingAsset.decimals,
			Discord.getInterfaceUrl(meta),
			event,
			getLinkToExplorerByTX(meta.network, event.trigger_unit)
		);
	}
}

module.exports = Discord;
