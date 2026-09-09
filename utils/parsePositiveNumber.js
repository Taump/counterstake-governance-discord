// Values come from `.env`, so they can be quoted strings
function parsePositiveNumber(value, { name = 'value', defaultValue, min } = {}) {
	const normalized = typeof value === 'string'
		? value.trim().replace(/^["'](.+)["']$/, '$1').trim()
		: value;

	if (normalized === undefined || normalized === null || normalized === '') {
		return defaultValue;
	}

	const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.warn(`invalid ${name} ${JSON.stringify(value)}, using default ${defaultValue}`);
		return defaultValue;
	}

	if (min !== undefined && parsed < min) {
		console.warn(`${name} ${parsed} is below the minimum ${min}, using ${min}`);
		return min;
	}

	return parsed;
}

module.exports = parsePositiveNumber;
