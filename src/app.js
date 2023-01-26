const express = require('express');
const bodyParser = require('body-parser');
const { sequelize, Contract } = require('./model');
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

    if (!contract) {
        return res.status(404).end();
    }

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

    if (!contract) {
        return res.status(404).end();
    }

    res.json(contract);
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job } = req.app.get('models');
    const { profile } = req;

    const jobs = await Job.findAll({
        where: {
            paid: { [Op.or]: { [Op.eq]: false, [Op.is]: null } },
            '$Contract.status$': { [Op.ne]: ContractState.TERMINATED },
            [Op.or]: [
                { '$Contract.ClientId$': profile.id },
                { '$Contract.ContractorId$': profile.id },
            ],
        },
        include: [{ model: Contract, as: Contract.modelName }],
    });

    if (!jobs) {
        return res.status(404).end();
    }

    res.json(jobs);
});

module.exports = app;
