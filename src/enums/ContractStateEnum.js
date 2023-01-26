const Enum = require('../tools/Enum.js');

const ContractStateEnum = Enum({
    NEW: 'new',
    IN_PROGRESS: 'in_progress',
    TERMINATED: 'terminated',
});

module.exports = ContractStateEnum;
