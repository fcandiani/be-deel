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
 * Helper method to update database data for testing purposes
 */
app.get('/update', async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const job = await Job.findOne({
        where: {
            id: { [Op.eq]: 14 },
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
        paid: true,
        paymentDate: new Date().toISOString(),
        ContractId: 8,
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
    const { Job, Contract } = req.app.get('models');
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
    const { Job, Profile, Contract } = req.app.get('models');
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
    const { Profile, Job, Contract } = req.app.get('models');
    const { amount } = req.body;
    const { userId } = req.params;

    const sequelizeTransaction = await sequelize.transaction();

    // zero is also considered a invalid amount
    if (!amount || typeof amount !== 'number' || amount < 0) {
        return res.status(422).json({ message: 'invalid amount' });
    }

    try {
        const jobsToPay = await Job.findAll(
            {
                where: {
                    paid: { [Op.or]: { [Op.eq]: false, [Op.is]: null } },
                    '$Contract.status$': { [Op.ne]: ContractState.TERMINATED },
                    [Op.or]: { '$Contract.ClientId$': userId },
                },
                include: [{ model: Contract, as: Contract.modelName }],
            },
            { lock: true, transaction: sequelizeTransaction }
        );

        if (!jobsToPay) {
            await sequelizeTransaction.rollback();
            return res.status(422).json({
                message: 'Cannot more than 25% his total of jobs to pay.',
            });
        }

        const amountDue = jobsToPay.reduce(
            (accumulator, currentValue) => accumulator + currentValue.price,
            0
        );

        if (amount > amountDue * 0.25) {
            await sequelizeTransaction.rollback();
            return res.status(422).json({
                message: 'Cannot more than 25% his total of jobs to pay.',
            });
        }

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

app.get('/admin/best-profession', getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models');
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(422).json({ message: 'invalid start or end date' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate) || isNaN(endDate)) {
        return res.status(422).json({ message: 'invalid start or end date' });
    }

    startDate.setUTCHours(0, 0, 0, 1);
    endDate.setUTCHours(23, 59, 59, 999);

    const bestPaidProfession = await Job.findOne({
        where: {
            paid: { [Op.eq]: true },
            paymentDate: { [Op.between]: [startDate, endDate] },
        },
        include: [
            {
                model: Contract,
                as: Contract.modelName,
                attributes: ['ContractorId'],
                include: [
                    {
                        model: Profile,
                        as: 'Contractor',
                        attributes: ['profession'],
                    },
                ],
            },
        ],
        attributes: [
            'ContractId',
            [sequelize.fn('sum', sequelize.col('price')), 'totalAmount'],
        ],
        group: 'ContractorId',
        order: [['totalAmount', 'DESC']],
    });

    if (!bestPaidProfession) {
        return res.status(404).end();
    }

    return res.status(200).json({
        amount: bestPaidProfession.totalAmount,
        name: bestPaidProfession.Contract.Contractor.profession,
    });
});

module.exports = app;
