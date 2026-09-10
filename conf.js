"use strict";
const path = require('path');
require('dotenv').config({ path: path.dirname(process.mainModule.paths[0]) + '/.env' });

exports.bServeAsHub = false;
exports.bLight = true;

exports.bNoPassphrase = true;

exports.discord_token = process.env.discord_token;
exports.discord_channels = [process.env.channel];

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.explorer_base_url = process.env.testnet ? 'https://testnetexplorer.obyte.org/#' : 'https://explorer.obyte.org/#';
exports.counterstake_base_url = process.env.testnet ? 'https://testnet-bridge.counterstake.org/governance/' : 'https://counterstake.org/governance/';

exports.governance_export_base_AAs = [
	'HLNWXGGHGXWMZN27W2722MNJCHH2IVAO',
	'IUUYZBNVT7ZRF5BM6HO2C464KT6534DV',
];
exports.governance_import_base_AAs = [
	'KDHCTQOTKTO6MLYOCU6OCBI7KK72DV3P',
	'RUUL66HRJ56W3GLHTFEKESF57L74WSM7',
];
exports.token_registry_AA_address = "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ";

exports.cs_url = process.env.testnet ? 'https://testnet-bridge.counterstake.org/api' : 'https://counterstake.org/api';

exports.ws_nodes = {
	Ethereum: process.env.ws_nodes_Ethereum,
	BSC: process.env.ws_nodes_BSC,
	Polygon: process.env.ws_nodes_Polygon,
	Kava: process.env.ws_nodes_Kava,
}

exports.scan_start_date = process.env.scan_start_date;
exports.address_scan_interval_hours = process.env.address_scan_interval_hours || 12;

exports.alert_check_interval_hours = Number(process.env.alert_check_interval_hours) || 6;

exports.trusted_oracles = process.env.testnet ? {
	// testnet oracles are not configured: the oracle policy is skipped there
} : {
	Ethereum: '0xAC4AA997A171A6CbbF5540D08537D5Cb1605E191',
	BSC: '0xdD52899A001a4260CDc43307413A5014642f37A2',
	Polygon: '0xdd603Fc2312A0E7Ab01dE2dA83e7776Af406DCeB',
	Kava: '0x16f5E8ad38cf676a0a78436ED8F5C8c19dA3be3d',
	Obyte: 'JPQKPRI5FMTQRJF4ZZMYZYDQVRD55OTC',
};

console.log('finished server conf');
