"use strict";
const logger = require("../../services/logger");
const log = new logger("IncomeController").getChildLogger();
const {
  incomeDbHandler,
  userDbHandler,
  investmentDbHandler,
  settingDbHandler,
  withdrawalDbHandler,
} = require("../../services/db");
const {
  getTopLevelByRefer,
  getPlacementIdByRefer,
  getPlacementId,
} = require("../../services/commonFun");
const mongoose = require("mongoose");
const cron = require("node-cron");
const config = require("../../config/config");
const { investmentModel } = require("../../models");
const { ethers }  = require('ethers');

const ObjectId = mongoose.Types.ObjectId;
const contractABI = process.env.WITHDRAW_ABI;
const contractAddress = process.env.WITHDRAW_ADDRESS

// Valid slot values for packages
const validSlots = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

const distributeTokens = async () => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));
    // Fetch all new users created today
    const newUsers = await userDbHandler.getByQuery({
      created_at: { $gte: startOfDay, $lt: endOfDay },
      status: 1,
    });

    for (const newUser of newUsers) {
      // Fetch previous users created before the new user
      const previousUsers = await userDbHandler.getByQuery({
        created_at: { $lt: newUser.created_at },
        status: 1,
      });
      console.log("previousUsers", previousUsers.length);
      if (previousUsers.length === 0) continue; // Skip if no previous users

      // Calculate total investment made by the new user today
      const investmentsToday = await investmentDbHandler.getByQuery({
        user_id: newUser._id,
        createdAt: { $gte: startOfDay, $lt: endOfDay },
        status: 1,
        type: 0,
      });

      const totalInvestment = investmentsToday.reduce(
        (sum, investment) => sum + investment.amount,
        0
      );

      if (totalInvestment === 0) continue; // Skip if no investment

      // Get the new user's highest package level
      const newUserPackages = await investmentDbHandler.getByQuery({
        user_id: newUser._id,
        status: 1
      });
      const newUserMaxPackage = newUserPackages.length > 0 ? 
        Math.max(...newUserPackages.map(inv => inv.slot_value)) : -1;

      const provisionAmount = totalInvestment * 0.4; // 40% of today's investment
      const amountPerUser = provisionAmount / previousUsers.length; // Distribute equally among previous users

      // Distribute to previous users
      for (let prevUser of previousUsers) {
        // Get the previous user's highest package level
        const prevUserPackages = await investmentDbHandler.getByQuery({
          user_id: prevUser._id,
          status: 1
        });
        const prevUserMaxPackage = prevUserPackages.length > 0 ? 
          Math.max(...prevUserPackages.map(inv => inv.slot_value)) : -1;

        // Skip if previous user's package level is lower than new user's
        if (prevUserMaxPackage < newUserMaxPackage) continue;

        if (prevUser.extra?.cappingLimit <= 0 || prevUser.extra?.cappingLimit < amountPerUser) {
          continue;
        }
        await userDbHandler.updateOneByQuery(
          { _id: ObjectId(prevUser._id) },
          {
            $inc: {
              wallet: amountPerUser,
              "extra.provisionIncome": amountPerUser,
              "extra.cappingLimit": -amountPerUser,
            },
          }
        );
        await incomeDbHandler.create({
          user_id: ObjectId(prevUser._id),
          user_id_from: ObjectId(newUser._id),
          type: 2,
          amount: amountPerUser,
          status: 1,
          extra: {
            income_type: "provision",
            fromPackageLevel: newUserMaxPackage
          },
        });
      }
    }

    log.info("Provision distribution completed successfully.");
  } catch (error) {
    log.error("Error in provision distribution", error);
  }
};
const AutoFundDistribution = async (req, res) => {
  try {
    const users = await withdrawalDbHandler.getByQuery({ amount: { $gt: 0 }, status: 0 });
    if (!users || users.length === 0) {
      log.info("No users with Withdraw balance found for auto withdraw.");
      return res
        .status(400)
        .json({ message: "No users eligible for withdraw" });
    }
    const batchSize = 20;
    const totalUsers = users.length;
    let batchStart = 0;
    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org:443');
    console.log("withdraw");
    const key = await settingDbHandler.getOneByQuery({name:"Keys"});
    console.log(key)
    const wallet = new ethers.Wallet(key.value, provider);
    const contract = new ethers.Contract(
      contractAddress,
      contractABI,
      wallet
    );
    
    while (batchStart < totalUsers) {
      const batchUsers = users.slice(batchStart, batchStart + batchSize);
      const addressArr = batchUsers.map((user) => `${user.address}`);
      const amountArr = batchUsers.map((user) => `${user.net_amount}`);
      
      log.info(`Sending batch ${batchStart / batchSize + 1} auto withdraw request:`);
      console.log("BatchUsr" , batchUsers);
      console.log("address", addressArr)
      console.log("amount" , amountArr)
      try {
        const tx = await contract.fundsDistribution(addressArr, amountArr);
        await tx.wait();
        
        let successAddresses = [];
        for (let i = 0; i < addressArr.length; i++) {
          let address = addressArr[i];
          let net_amount = amountArr[i];
          
          try {
            let data = await contract.users(address);
            // Compare amounts in Wei
            if (net_amount == data.lastClaimAmount) {
              successAddresses.push(address);
            }
          } catch (error) {
            log.error(`Error fetching details for ${address}:`, error);
          }
        }
        
        console.log(successAddresses);
        log.info(`Batch ${batchStart / batchSize + 1} auto withdraw successful`);
        log.info("successAddresses", successAddresses);
        
        for (let user of batchUsers) {
          if (successAddresses.includes(user.address)) {
            const res = await withdrawalDbHandler.updateOneByQuery(
              { _id: ObjectId(user._id) },
              { $set: { status: 1, remark: "SUCCESS" } }
            );
            console.log("Withdrawal status updated:", res);
          }
        }
      } catch (error) {
        log.error(`Batch ${batchStart / batchSize + 1} failed:`, error);
        // Continue with next batch even if current batch fails
      }
      
      batchStart += batchSize;
    }
    
    log.info("All batches processed successfully.");
    return res.status(200).json({ message: "All auto withdraw batches completed" });
    
  } catch (error) {
    log.error("Error during minting request:", error.message);
    return res.status(400).json({ message: "Error during minting" });
  }
};

// Distribute Level Income
const distributeLevelIncome = async (user_id, amount, fromPackageLevel) => {
  try {
    let topLevels = await getTopLevelByRefer(
      user_id,
      config.levelIncomePercentages.length
    );
    for (let i = 0; i < topLevels.length; i++) {
      let levelUser = topLevels[i];
      if (!levelUser) continue;
      console.log("levelUser", levelUser);

      const levelUsers = await userDbHandler.getOneByQuery({
        _id: ObjectId(topLevels[i]),
      });

      // Get the user's highest package level using slot_value
      const userPackages = await investmentDbHandler.getByQuery({
        user_id: ObjectId(levelUser),
        status: 1
      });
      const userMaxPackage = userPackages.length > 0 ? 
        Math.max(...userPackages.map(inv => inv.slot_value)) : -1;

      // Skip if user's package level is lower than the income source's package level
      if (userMaxPackage < fromPackageLevel) continue;

      let levelAmount = (amount * config.levelIncomePercentages[i]) / 100;
      if (levelUsers.extra.cappingLimit <= 0 || levelUsers.extra.cappingLimit <= levelAmount) {
        continue;
      }
      await userDbHandler.updateOneByQuery(
        { _id: ObjectId(levelUser) },
        {
          $inc: {
            wallet : levelAmount,
            reward: levelAmount,
            "extra.levelIncome": levelAmount,
            "extra.totalIncome": levelAmount,
            "extra.cappingLimit": -levelAmount,
          },
        }
      );

      await incomeDbHandler.create({
        user_id: levelUser,
        user_id_from: user_id,
        amount: levelAmount,
        level: i + 1,
        type: 5,
        remarks: `Level ${i + 1} income ${
          amount * config.levelIncomePercentages[i]
        }%`,
        extra: {
          income_type: "level",
          fromPackageLevel
        },
      });
    }
  } catch (error) {
    log.error("Error in level income distribution", error);
  }
};

// Transfer Remaining to Reward & Achiever Wallet
const transferToRewardWallet = async (amount) => {
  try {
    await userDbHandler.updateOneByQuery(
      { _id: ObjectId(config.rewardWallet) },
      { $inc: { wallet: amount } }
    );

    await incomeDbHandler.create({
      user_id: config.rewardWallet,
      amount: amount,
      type: 4,
      remarks: "Reward & Achiever Wallet Distribution",
    });
  } catch (error) {
    log.error("Error transferring to Reward & Achiever Wallet", error);
  }
};

// Schedule Cron Job to Run Daily at Midnight
// cron.schedule('0 0 * * *', distributeTokens, {
//     scheduled: true,
//     timezone: "UTC"
// });

const distributeTokensHandler = async (req, res) => {
  try {
    await distributeTokens(); // Call the function that handles the distribution
    res
      .status(200)
      .json({ message: "Token distribution triggered successfully" });
  } catch (error) {
    log.error("Error triggering token distribution", error);
    res.status(500).json({ message: "Error triggering token distribution" });
  }
};

const distributeGlobalAutoPoolMatrixIncome = async (user_id, amount, fromPackageLevel) => {
  try {
    // Fetch the new user
    const newUser = await userDbHandler.getById(user_id);
    if (!newUser) throw new Error("User not found");

    // Use the placement_id stored in the newUser object
    let currentPlacementId = newUser.placement_id;
    if (!currentPlacementId) throw new Error("No placement available");

    // Calculate matrix income (10% of the amount)
    const matrixIncome = (amount * 10) / 100;

    // Traverse the placement hierarchy until placement_id becomes null
    while (currentPlacementId) {
      const placementUser = await userDbHandler.getOneByQuery({
        _id: ObjectId(currentPlacementId),
      });
      if (!placementUser) break;

      // Get the placement user's highest package level using slot_value
      const userPackages = await investmentDbHandler.getByQuery({
        user_id: ObjectId(currentPlacementId),
        status: 1
      });
      const userMaxPackage = userPackages.length > 0 ? 
        Math.max(...userPackages.map(inv => inv.slot_value)) : -1;

      // Skip if user's package level is lower than the income source's package level
      if (userMaxPackage < fromPackageLevel) {
        currentPlacementId = placementUser.placement_id;
        continue;
      }

      console.log("placementUser", placementUser.extra);
      if (placementUser.extra.cappingLimit <= 0 || placementUser.extra.cappingLimit < matrixIncome) {
        currentPlacementId = placementUser.placement_id;
        continue;
      }
      // Distribute matrix income to the placement user
      await userDbHandler.updateOneByQuery(
        { _id: ObjectId(currentPlacementId) },
        {
          $inc: {
            wallet: matrixIncome,
            "extra.matrixIncome": matrixIncome,
            "extra.cappingLimit": -matrixIncome,
          },
        }
      );

      await incomeDbHandler.create({
        user_id: ObjectId(currentPlacementId),
        user_id_from: ObjectId(user_id),
        amount: matrixIncome,
        type: 6,
        status: 1,
        extra: {
          income_type: "matrix",
          fromPackageLevel
        },
      });

      // Move to the next placement user
      currentPlacementId = placementUser.placement_id;
    }

    return true;
  } catch (error) {
    log.error("Error in matrix income distribution:", error);
    throw error;
  }
};

module.exports = {
  distributeTokensHandler,
  distributeLevelIncome,
  distributeGlobalAutoPoolMatrixIncome,
  AutoFundDistribution
};
