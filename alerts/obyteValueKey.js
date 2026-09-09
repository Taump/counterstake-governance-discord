const crypto = require('crypto');

// Mirrors $get_value_key of the governance AAs, which builds the `support_<name>_<key>` var
// name: export governance uses the value itself, import governance hashes it once the name
// would exceed 128 chars (the AA measures that with its longest parameter name, `oracles`).
function getObyteValueKey(value, isImport) {
	const str = String(value);
	if (!isImport) return str;
	return (('support_oracles_' + str + '_').length + 32) > 128
		? crypto.createHash('sha256').update(str, 'utf8').digest('base64')
		: str;
}

module.exports = getObyteValueKey;
