const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model');
const { Op } = require('sequelize');
const { getProfile } = require('./middleware/getProfile');
const app = express();

const ContractState = require('./enums/ContractStateEnum.js');

app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/**
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { id } = req.params;
    const { profile } = req;
    const contract = await Contract.findOne({
        where: {
            id,
            [Op.or]: [{ ClientId: profile.id }, { ContractorId: profile.id }],
        },
    });
    if (!contract) return res.status(404).end();
    res.json(contract);
});

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { profile } = req;
    const contract = await Contract.findOne({
        where: {
            status: { [Op.ne]: ContractState.TERMINATED },
            [Op.or]: [{ ClientId: profile.id }, { ContractorId: profile.id }],
        },
    });
    if (!contract) return res.status(404).end();
    res.json(contract);
});

module.exports = app;
