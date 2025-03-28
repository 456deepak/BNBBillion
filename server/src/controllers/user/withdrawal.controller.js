'use strict';
const logger = require('../../services/logger');
const log = new logger('WithdrawalController').getChildLogger();
const { withdrawalDbHandler, userDbHandler, settingDbHandler } = require('../../services/db');
const responseHelper = require('../../utils/customResponse');
const config = require('../../config/config');
const { userModel } = require('../../models');
const axios = require('axios')

const ethers = require('ethers');

const getExchangeRate = async (amount) => {
    try {

        const response = await axios.post(
            'https://api.coinbrain.com/public/coin-info',
            { "56": ["0xC9F641c5EF43C845897Aaf319e80bceA729d2a1F"] }
        )

        if (response.status !== 200) throw "No Conversion Rate Found!"

        let conversionRate = 1 / response.data[0]?.priceUsd
        return {
            conversionRate,
            netAmount: (conversionRate * amount).toFixed(4)
        }

    } catch (error) {
        throw error
    }
}

const withdrawStatusType = {
    0: "PENDING",
    1: "REJECTED",
    2: "APPROVED"
}

const initiateTxn = async (txn, priv_key) => {
    try {

        let hash = null
        const provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed1.binance.org:443');

        const wallet = new ethers.Wallet(priv_key, provider);

        // Create contract instance
        const contractInstance = new ethers.Contract(config.withdrawAddress, config.withdrawABI, wallet);
        const amount = (txn.net_amount * (10 ** 18)).toString()

        // Calculate gas fee
        let gasLimit = await contractInstance.estimateGas["transfer"](txn.address, amount)
        let gasPrice = await provider.getGasPrice()
        gasLimit = gasLimit.mul(110).div(100)
        gasPrice = gasPrice.mul(2)

        // Check wallet balance for gas fee
        const balance = await wallet.getBalance();
        if (balance.lt(gasPrice)) {
            throw 'Insufficient balance for gas fee'
        }

        try {

            hash = (await contractInstance.transfer(txn.address, amount, { gasLimit, gasPrice })).hash

        } catch (error) {
            console.error('Error:', error)
            hash = error.transaction.hash
        }

        // make the status approved/pending/rejected accordingly
        if (hash) {
            txn.txid = hash
            txn.status = 2
        } else {
            txn.status = 0
        }
        txn.remark = withdrawStatusType[txn.status]
        await txn.save()

    } catch (error) {
        throw error
    }
}

module.exports = {

    getAll: async (req, res) => {
        let reqObj = req.query;
        let user = req.user;
        let user_id = user.sub;
        log.info('Recieved request for getAll:', reqObj);
        let responseData = {};
        try {
            let getList = await withdrawalDbHandler.getAll(reqObj, user_id);
            responseData.msg = 'Data fetched successfully!';
            responseData.data = getList;
            return responseHelper.success(res, responseData);
        } catch (error) {
            log.error('failed to fetch data with error::', error);
            responseData.msg = 'Failed to fetch data';
            return responseHelper.error(res, responseData);
        }
    },

    getOne: async (req, res) => {
        let responseData = {};
        let user = req.user;
        let user_id = user.sub;
        let id = req.params.id;
        try {
            let getData = await withdrawalDbHandler.getById(id);
            responseData.msg = "Data fetched successfully!";
            responseData.data = getData;
            return responseHelper.success(res, responseData);
        } catch (error) {
            log.error('failed to fetch data with error::', error);
            responseData.msg = 'Failed to fetch data';
            return responseHelper.error(res, responseData);
        }
    },

    add: async (req, res) => {
        let responseData = {};
        let user = req.user;
        let user_id = user.sub;
        let reqObj = req.body;
        try {
            let user = await userDbHandler.getById(user_id);
            let amount = parseFloat(reqObj.amount);
            let address = reqObj?.address ? reqObj?.address : user.username;
            let net_amount = reqObj?.net_amount
            // Check if user has sufficient balance
            if (user?.wallet < amount) {
                responseData.msg = `Insufficient Fund!`;
                return responseHelper.error(res, responseData);
            }
           
            // Prepare data for storage
            let data = {
                user_id: user_id,
                amount: amount,
                net_amount: net_amount,
                address: address,
                extra: {
                    walletType: 'wallet'
                }
            }

            // Update user's wallet balance
            await userModel.updateOne(
                { _id: user_id },
                {
                    $inc: {
                        wallet: -amount,
                        wallet_withdraw: amount,
                        "extra.withdrawals": amount
                    }
                }
            ).then(async val => {
                if (!val.modifiedCount > 0) throw "Unable to update amount!"
                
                // Create withdrawal record
                await withdrawalDbHandler.create(data)
                    .catch(e => { throw `Something went wrong while creating withdrawal report: ${e}` })
            }).catch(e => { throw e })

            responseData.msg = "Amount has been withdrawn successfully!";
            return responseHelper.success(res, responseData);
        } catch (error) {
            log.error('failed to update data with error::', error);
            responseData.msg = typeof error === 'string' ? error : "Failed to process withdrawal";
            return responseHelper.error(res, responseData);
        }
    },

    getCount: async (req, res) => {
        let responseData = {};
        let user = req.user;
        let user_id = user.sub;
        let reqObj = req.query;
        try {
            let getData = await withdrawalDbHandler.getCount(reqObj, user_id);
            responseData.msg = "Data fetched successfully!";
            responseData.data = getData;
            return responseHelper.success(res, responseData);
        } catch (error) {
            log.error('failed to fetch data with error::', error);
            responseData.msg = 'Failed to fetch data';
            return responseHelper.error(res, responseData);
        }
    },

    getSum: async (req, res) => {
        let responseData = {};
        let user = req.user;
        let user_id = user.sub;
        let reqObj = req.query;
        try {
            let getData = await withdrawalDbHandler.getSum(reqObj, user_id);
            responseData.msg = "Data fetched successfully!";
            responseData.data = getData;
            return responseHelper.success(res, responseData);
        } catch (error) {
            log.error('failed to fetch data with error::', error);
            responseData.msg = 'Failed to fetch data';
            return responseHelper.error(res, responseData);
        }
    },
};