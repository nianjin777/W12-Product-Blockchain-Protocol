const BigNumber = web3.BigNumber;

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

const crypto = require('crypto');

const W12Lister = artifacts.require('W12Lister');
const W12CrowdsaleFactory = artifacts.require('W12CrowdsaleFactory');
const WToken = artifacts.require('WToken');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function generateRandomAddress() {
    return `0x${crypto.randomBytes(20).toString('hex')}`;
};

contract('W12Lister', async (accounts) => {
    let sut;
    let token;
    let factory;
    const wallet = accounts[9];
    const oneToken = new BigNumber(1).pow(18);

    beforeEach(async () => {
        factory = await W12CrowdsaleFactory.new();
        sut = await W12Lister.new(wallet, factory.address);
        token = await WToken.new('TestToken', 'TT', 18);
    });

    describe('when called by the owner', async () => {
        it('should initialize wallet with supplied address', async () => {
            const actualWalletAddress = await sut.serviceWallet().should.be.fulfilled;

            actualWalletAddress.should.be.equal(wallet);
        });

        it('should add token to listing', async () => {
            const whitelistedTokensCountBefore = await sut.approvedTokensLength().should.be.fulfilled;

            const receipt = await sut.whitelistToken(accounts[1], token.address, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.fulfilled;

            (await sut.approvedTokensLength()).should.bignumber.equal(whitelistedTokensCountBefore + 1);

            receipt.logs[0].event.should.be.equal('OwnerWhitelisted');
            receipt.logs[0].args.tokenAddress.should.be.equal(token.address);
            receipt.logs[0].args.tokenOwner.should.be.equal(accounts[1]);
            receipt.logs[0].args.name.should.be.equal("TestTokenForSale");
            receipt.logs[0].args.symbol.should.be.equal("TTFS");
        });

        it('should check that input addresses are not zeros', async () => {
            await sut.whitelistToken(accounts[1], ZERO_ADDRESS, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.rejected;
            await sut.whitelistToken(ZERO_ADDRESS, token.address, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.rejected;
            await sut.whitelistToken(ZERO_ADDRESS, ZERO_ADDRESS, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.rejected;
        });

        it('should reject add the same token for the same owner multiple times', async () => {
            await sut.whitelistToken(accounts[1], token.address, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.fulfilled;
            await sut.whitelistToken(accounts[1], token.address, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.rejected;
        });

        it('should allow to add the same token for different owners', async () => {
            await sut.whitelistToken(accounts[1], token.address, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.fulfilled;
            await sut.whitelistToken(accounts[2], token.address, "TestTokenForSale", "TTFS", 18, 50, 50).should.be.fulfilled;
        });

        it('should allow to add different tokens for the same owner', async () => {
            await sut.whitelistToken(accounts[1], generateRandomAddress(), "TestTokenForSale", "TTFS", 18, 50, 50).should.be.fulfilled;
            await sut.whitelistToken(accounts[1], generateRandomAddress(), "TestTokenForSale", "TTFS", 18, 50, 50).should.be.fulfilled;
        });

        describe('when token is listed', async () => {
            let tokenOwner = accounts[1];
            const oneToken = new BigNumber(10).pow(18);
            let placementReceipt;

            beforeEach(async () => {
                await sut.whitelistToken(tokenOwner, token.address, "TestTokenz", "TT", 18, 30, 30);
                await token.mint(tokenOwner, oneToken.mul(10000), 0);
                await token.approve(sut.address, oneToken.mul(10000), {from: tokenOwner});

                placementReceipt = await sut.placeToken(token.address, oneToken.mul(10), {from: tokenOwner}).should.be.fulfilled;
            });

            it('should place token to exchange', async () => {
                placementReceipt.logs[0].event.should.be.equal('TokenPlaced');
                placementReceipt.logs[0].args.originalTokenAddress.should.be.equal(token.address);
                placementReceipt.logs[0].args.tokenAmount.should.bignumber.equal(oneToken.mul(7));
                placementReceipt.logs[0].args.placedTokenAddress.should.not.be.equal(ZERO_ADDRESS);

                const swapAddress = await sut.swap();
                const serviceWalletAddress = await sut.serviceWallet();
                const actualExchangerBalance = await token.balanceOf(swapAddress);
                const actualServiceWalletBalance = await token.balanceOf(serviceWalletAddress);

                actualExchangerBalance.should.bignumber.equal(oneToken.mul(7));
                actualServiceWalletBalance.should.bignumber.equal(oneToken.mul(3));
            });
        });
    });

    describe('when called not by the owner', async () => {
        const fromSystemAccount = { from: accounts[0] };
        const fromTokenOwner = { from: accounts[1] };

        beforeEach(async () => {
            sut = await W12Lister.new(accounts[1], factory.address, fromSystemAccount);
        });

        it('should reject whitelisting a token', async () => {
            await sut.whitelistToken(generateRandomAddress(), generateRandomAddress(), "", "", 1, 1, 1, fromTokenOwner).should.be.rejected;
        });

        describe('when owner set the crowdsale', async () => {
            beforeEach(async () => {
                await sut.whitelistToken(fromTokenOwner.from, token.address, "TestTokenz", "TT", 18, 30, 30, fromSystemAccount);
                await token.mint(fromTokenOwner.from, oneToken.mul(10000), 0, fromSystemAccount);
                await token.approve(sut.address, oneToken.mul(10000), fromTokenOwner);

                await sut.placeToken(token.address, oneToken.mul(10), fromTokenOwner).should.be.fulfilled;
            });

            describe('token owner', async () => {
                it('should initialize crowdsale', async () => {
                    await sut.initCrowdsale(
                            Date.UTC(2018, 11, 1) / 1000,
                            token.address,
                            oneToken.mul(10),
                            oneToken,
                            fromTokenOwner
                        ).should.be.fulfilled;

                    const crowdsaleAddress = await sut.getTokenCrowdsale(token.address).should.be.fulfilled;

                    crowdsaleAddress.should.not.be.equal(ZERO_ADDRESS);
                });
            });
        });
    });
});
