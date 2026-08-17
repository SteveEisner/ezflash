const PINNED_ESPTOOL_CHIPS=Object.freeze({
	ESP32:"esp32",
	"ESP32-C3":"esp32c3",
	"ESP32-S3":"esp32s3beta2"
});

// Adapts exact update-contract chip identities to esptool 3.1's accepted spellings.
export function pinnedEsptoolChip(canonicalChipIdentity){
	const chip=PINNED_ESPTOOL_CHIPS[canonicalChipIdentity];
	if(!chip)throw Error(`unsupported canonical chip identity: ${canonicalChipIdentity}`);
	return chip;
}
