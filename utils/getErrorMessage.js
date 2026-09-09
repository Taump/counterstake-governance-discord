// ethers puts the useful text in shortMessage; some libraries throw non-Errors
function getErrorMessage(error) {
	return error?.shortMessage || error?.message || String(error);
}

module.exports = getErrorMessage;
