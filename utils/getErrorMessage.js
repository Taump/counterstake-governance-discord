// ethers puts the useful text in shortMessage, some errors carry only a code, and some
// libraries throw non-Errors
function getErrorMessage(error) {
	return error?.shortMessage || error?.message || error?.code || String(error);
}

module.exports = getErrorMessage;
