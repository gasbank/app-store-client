import {
    AppStoreServerAPIClient,
    Environment,
    GetTransactionHistoryVersion,
    Order,
    ProductType,
    HistoryResponse,
    TransactionHistoryRequest,
    SignedDataVerifier
} from "@apple/app-store-server-library"

import {
    TransactionInfoResponse,
    TransactionInfoResponseValidator
} from "@apple/app-store-server-library/dist/models/TransactionInfoResponse";

import * as express from "express";

const fs = require('node:fs');

function loadRootCAs() {
    return [
        fs.readFileSync(process.env.APPLE_ROOT_CA_1_FILE_PATH),
        fs.readFileSync(process.env.APPLE_ROOT_CA_2_FILE_PATH),
        fs.readFileSync(process.env.APPLE_ROOT_CA_3_FILE_PATH),
        fs.readFileSync(process.env.APPLE_ROOT_CA_4_FILE_PATH),
    ];
}

async function verifyTransactionId(transactionId: string, appleRootCAs: Buffer[], environment: Environment, bundleId: string) {
    const client = new AppStoreServerAPIClient(encodedKey, keyId, issuerId, bundleId, environment)

    // Transaction ID 하나만 알면, 그 사람이 지금까지 구매한 모든 히스토리를 할 수 있다.
    const transactionHistoryRequest: TransactionHistoryRequest = {
        sort: Order.ASCENDING,
        revoked: false,
        productTypes: [ProductType.CONSUMABLE]
    }
    let response: HistoryResponse | null = null
    let transactions: string[] = []
    do {
        const revisionToken = response !== null && response.revision !== null ? response.revision : null

        response = await client.getTransactionHistory(transactionId, revisionToken, transactionHistoryRequest, GetTransactionHistoryVersion.V2)
        if (response.signedTransactions) {
            transactions = transactions.concat(response.signedTransactions)
        }
    } while (response.hasMore)
    console.log(transactions)

    // Transaction ID 하나에만 해당되는 구매 정보를 가져온다.
    // 서명 포함된, 해석이 필요한 상태로 가져온다.
    let infoResponse: TransactionInfoResponse | null = null
    let transactionInfo: string
    infoResponse = await client.getTransactionInfo(transactionId)

    if (infoResponse.signedTransactionInfo) {
        transactionInfo = infoResponse.signedTransactionInfo
    }
    console.log(transactionInfo)

    // 서명이 올바른지 확인한다. 올바른 Transaction Info인지를 검증할 뿐 해석은 해 주지 않는다.
    const validator = new TransactionInfoResponseValidator()
    const validationResult = validator.validate(transactionInfo)
    console.log(validationResult)

    // 서명이 올바른지 확인할 뿐 아니라, 내부 정보를 읽을 수 있도록 해석까지 해 준다.
    const enableOnlineChecks = true
    const appAppleId: any = process.env.APPLE_ID // appAppleId is required when the environment is Production
    const verifier = new SignedDataVerifier(appleRootCAs, enableOnlineChecks, environment, bundleId, appAppleId)
    const verifiedTransactionInfo = await verifier.verifyAndDecodeTransaction(transactionInfo)
    console.log(verifiedTransactionInfo)

    return verifiedTransactionInfo
}

////////////////////////////////////////////////////////////////////////////

console.log("Running app-store-client...")

require("dotenv").config();

const appleRootCAs: Buffer[] = loadRootCAs() // Specific implementation may vary

const issuerId = process.env.APPLE_ISSUER_ID
const keyId = process.env.APPLE_KEY_ID
const filePath = process.env.APPLE_P8_FILE_PATH
const encodedKey = fs.readFileSync(filePath) // Specific implementation may vary

const app = express();
const port = process.env.SERVICE_PORT;

app.post('/verify', async (req, res) => {

    const bundleId = req.header('Package-Name')
    const environment = req.header('Environment')
    const transactionId = req.header('Transaction-Id')
    const productId = req.header('Product-Id')

    try {
        const verifiedTransactionInfo = await verifyTransactionId(transactionId, appleRootCAs, environment == 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION, bundleId);
        const validPurchase = verifiedTransactionInfo.inAppOwnershipType == 'PURCHASED' && verifiedTransactionInfo.productId == productId;

        if (validPurchase) {
            res.setHeader('Order-Id', transactionId)
            res.status(200)
        } else {
            res.status(400)
        }

        res.send(validPurchase ? 'OK' : 'Error')
    } catch (e) {
        res.send(e.httpStatusCode)
    }
});

app.listen(port, () => {
    console.log(`app-store-client listening at http://localhost:${port}`);
});