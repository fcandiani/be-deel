const Enum = (enumData) => ({
    ...enumData,
    values: () => Object.values(enumData),
    keys: () => Object.keys(enumData),
    key: (value) =>
        Object.keys(enumData).find((key) => enumData[key] === value),
});

module.exports = Enum;
