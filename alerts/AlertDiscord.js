const Discord = require('discord.js');
const conf = require('ocore/conf.js');

const { formatUtc } = require('./timing');
const crashOnError = require('../utils/crashOnError');
const sleep = require('../utils/sleep');
const getErrorMessage = require('../utils/getErrorMessage');

const LIMITS = {
	title: 256,
	description: 4096,
	footer: 2048,
	total: 6000,
	value: 200, // cap for attacker-controlled values (leader/current/safe value/names)
};

const ALERT_COLOR = '#ff0000';
const RETRY_DELAY_SECONDS = 5;
const MAX_ATTEMPTS = 5;

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

function buildEmbed(alert) {
	const {
		aaName, url, name, leaderValue, currentValue, safeValue,
		leaderSupport, expiryTs, canCommit, now,
	} = alert;

	// the fields carry every fact, so the description is only the link
	const challengingPeriodEnds = canCommit
		? `${formatUtc(expiryTs)} (expired, can be committed now)`
		: formatUtc(expiryTs);

	const embed = new Discord.MessageEmbed()
		.setColor(ALERT_COLOR)
		.setTitle(truncate('⚠️ Alert: unsafe leader value in ' + sanitizeText(aaName), LIMITS.title))
		.setDescription(truncate(`[View on interface](${url})`, LIMITS.description))
		.addFields(
			{ name: 'Parameter', value: sanitizeCode(name), inline: true },
			{ name: 'Leader value', value: sanitizeCode(leaderValue), inline: true },
			{ name: 'Safe value', value: sanitizeText(safeValue), inline: true },
			{ name: 'Leader support', value: sanitizeText(leaderSupport), inline: true },
			{ name: 'Current value', value: sanitizeCode(currentValue), inline: true },
			{ name: 'Challenging period ends', value: challengingPeriodEnds, inline: true },
		)
		.setFooter(truncate(`Checked at ${formatUtc(now)}`, LIMITS.footer));

	const overflow = embed.length - LIMITS.total;
	if (overflow > 0)
		embed.setDescription(truncate(embed.description, Math.max(0, embed.description.length - overflow)));
	return embed;
}

function isNonRetryableError(error) {
	const status = error?.httpStatus;
	return Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
}

class AlertDiscord {
	static #instance = null;

	#token;
	#channels;
	#loginPromise = null;
	#queue = Promise.resolve();

	constructor({ token, channels }) {
		this.#token = token;
		this.#channels = channels;
	}

	static getInstance() {
		if (AlertDiscord.#instance) return AlertDiscord.#instance;

		if (!conf.discord_token) throw Error('discord_token missing in conf');
		if (!conf.discord_channels?.length) throw Error('channels missing in conf');
		AlertDiscord.#instance = new AlertDiscord({
			token: conf.discord_token,
			channels: conf.discord_channels,
		});
		return AlertDiscord.#instance;
	}

	#ensureLoggedIn() {
		if (!this.#loginPromise) {
			this.#loginPromise = (async () => {
				const client = new Discord.Client();
				client.on('error', (error) => {
					console.error(`Discord alert client error: ${getErrorMessage(error)}`);
				});
				await client.login(this.#token);
				console.error('Discord alert client logged in');
				return client;
			})().catch((error) => {
				this.#loginPromise = null;
				throw error;
			});
		}
		return this.#loginPromise;
	}

	announceUnsafeLeader(alert) {
		const embed = buildEmbed(alert);
		const result = this.#queue.then(() => this.#send(embed));
		this.#queue = result.catch(() => {});
		return result;
	}

	async #send(embed) {
		for (const channelId of this.#channels)
			await this.#sendToChannel(channelId, embed);
	}

	async #sendToChannel(channelId, embed) {
		let lastError = null;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				const client = await this.#ensureLoggedIn();
				const channel = await client.channels.fetch(channelId);
				await channel.send(embed);
				return console.error(`Discord alert sent to channel ${channelId}`);
			} catch (error) {
				lastError = error;
				if (isNonRetryableError(error)) {
					return console.error(`Discord alert rejected for channel ${channelId} (HTTP ${error.httpStatus}): ${getErrorMessage(error)}`);
				}
				console.error(`Discord alert attempt ${attempt}/${MAX_ATTEMPTS} failed for channel ${channelId}: ${getErrorMessage(error)}`);
				if (attempt < MAX_ATTEMPTS)
					await sleep(RETRY_DELAY_SECONDS);
			}
		}
		crashOnError(`Discord alert failed after ${MAX_ATTEMPTS} attempts for channel ${channelId}`, lastError);
	}
}

module.exports = AlertDiscord;
