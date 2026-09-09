const Discord = require('discord.js');

// Alert values come from voters, so everything rendered goes through the helpers below.
const LIMITS = {
	title: 256,
	description: 4096,
	fieldName: 256,
	fieldValue: 1024,
	footer: 2048,
	total: 6000,
	value: 200, // cap for attacker-controlled values (leader/current/reason/safe value/names)
};

function truncate(str, max) {
	if (str.length <= max) return str;
	return str.slice(0, Math.max(0, max - 1)) + '…';
}

function collapseWhitespace(value) {
	return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sanitizeText(value, max = LIMITS.value) {
	return truncate(Discord.Util.escapeMarkdown(collapseWhitespace(value)), max);
}

// backticks and newlines cannot be escaped inside a code span, so they are removed
function sanitizeCode(value, max = LIMITS.value) {
	const str = collapseWhitespace(String(value ?? '').replace(/[`\r\n]/g, ' '));
	return '`' + truncate(str || '-', max) + '`';
}

function formatUtc(timestamp) {
	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || ts <= 0) return 'unknown';
	return new Date(Math.floor(ts) * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

module.exports = {
	LIMITS,
	truncate,
	sanitizeText,
	sanitizeCode,
	formatUtc,
};
