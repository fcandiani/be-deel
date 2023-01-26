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
 * Helper method to update database data for testing purposes
 */
app.get('/update', async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const job = await Job.findOne({
        where: {
            id: { [Op.eq]: 2 },
        },
    });

    const profile = await Profile.findOne({
        where: {
            id: { [Op.eq]: 2 },
        },
    });

    const contract = await Contract.findOne({
        where: {
            id: { [Op.eq]: 2 },
        },
    });

    job.update({
        paid: null,
        paymentDate: null,
    });

    profile.update({});
    contract.update({});

    return res.status(200).end();
});

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

    return res.json(contract);
});

/**
 * @returns all non-terminated contracts
 */
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

    return res.json(contract);
});

/**
 * @returns all unpaid jobs
 */
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

    return res.json(jobs);
});

/**
 * @returns pay fully for a job by id
 */
// TODO: Since is a post method, should we received the amount that is being paid?
app.post('/jobs/:jobId/pay', getProfile, async (req, res) => {
    const { Job, Profile } = req.app.get('models');
    const { profile } = req;
    const { jobId } = req.params;

    const sequelizeTransaction = await sequelize.transaction();

    try {
        const job = await Job.findOne(
            {
                where: {
                    id: { [Op.eq]: jobId },
                    paid: { [Op.or]: { [Op.eq]: false, [Op.is]: null } },
                    '$Contract.status$': { [Op.ne]: ContractState.TERMINATED },
                    [Op.or]: { '$Contract.ClientId$': profile.id },
                },
                include: [{ model: Contract, as: Contract.modelName }],
            },
            { lock: true, transaction: sequelizeTransaction }
        );

        if (!job) {
            await sequelizeTransaction.rollback();
            return res.status(404).end();
        }

        if (job.price >= profile.balance) {
            await sequelizeTransaction.rollback();
            return res.status(403).json({ message: 'Not enough balance!' });
        }

        const contractor = await Profile.findOne(
            {
                where: {
                    id: { [Op.eq]: job.Contract.ContractorId },
                },
            },
            { lock: true, transaction: sequelizeTransaction }
        );

        if (!contractor) {
            await sequelizeTransaction.rollback();
            return res.status(404).end();
        }

        await profile.update(
            {
                balance: profile.balance - job.price,
            },
            { transaction: sequelizeTransaction }
        );

        await contractor.update(
            {
                balance: contractor.balance + job.price,
            },
            { transaction: sequelizeTransaction }
        );

        await job.update(
            {
                paid: true,
                paymentDate: new Date().toISOString(),
            },
            { transaction: sequelizeTransaction }
        );

        // TODO: should a contract be terminated when a payment is made?

        await sequelizeTransaction.commit();

        return res.json(job);
    } catch (error) {
        await sequelizeTransaction.rollback();
    }

    return res.status(500).end();
});

/**
 * @returns pay fully for a job by id
 */
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { Profile } = req.app.get('models');
    const { amount } = req.body;
    const { userId } = req.params;

    const sequelizeTransaction = await sequelize.transaction();

    // zero is also considered a invalid amount
    if (!amount || typeof amount !== 'number' || amount < 0) {
        return res.status(422).json({ message: 'invalid amount' });
    }

    try {
        const depositReceiver = await Profile.findOne(
            {
                where: {
                    id: { [Op.eq]: userId },
                },
            },
            { lock: true, transaction: sequelizeTransaction }
        );

        if (!depositReceiver) {
            await sequelizeTransaction.rollback();
            return res.status(404).end();
        }

        await depositReceiver.update({
            balance: depositReceiver.balance + amount,
        });

        return res.json(depositReceiver);
    } catch (error) {
        await sequelizeTransaction.rollback();
    }

    return res.status(500).end();
});

module.exports = app;
