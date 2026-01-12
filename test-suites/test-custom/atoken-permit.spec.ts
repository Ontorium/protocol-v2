import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../../helpers/constants';
import { BUIDLEREVM_CHAINID } from '../../helpers/buidler-constants';
import { buildPermitParams, getSignatureFromTypedData } from '../../helpers/contracts-helpers';
import { expect } from 'chai';
import { ethers } from 'ethers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { DRE } from '../../helpers/misc-utils';
import { waitForTx } from '../../helpers/misc-utils';
import { _TypedDataEncoder } from 'ethers/lib/utils';

const { parseEther } = ethers.utils;

makeSuite('AToken: Permit', (testEnv: TestEnv) => {
  it('Checks the domain separator', async () => {
    const { aAGT } = testEnv;
    const separator = await aAGT.DOMAIN_SEPARATOR();

    const domain = {
      name: await aAGT.name(),
      version: '1',
      chainId: DRE.network.config.chainId,
      verifyingContract: aAGT.address,
    };
    const domainSeparator = _TypedDataEncoder.hashDomain(domain);

    expect(separator).to.be.equal(domainSeparator, 'Invalid domain separator');
  });

  it('Get aAGT for tests', async () => {
    const { agt, pool, deployer } = testEnv;

    await agt.mint(parseEther('20000'));
    await agt.approve(pool.address, parseEther('20000'));

    await pool.deposit(agt.address, parseEther('20000'), deployer.address, 0);
  });

  it('Reverts submitting a permit with 0 expiration', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const tokenName = await aAGT.name();

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const expiration = 0;
    const nonce = (await aAGT._nonces(owner.address)).toNumber();
    const permitAmount = ethers.utils.parseEther('2').toString();
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      tokenName,
      owner.address,
      spender.address,
      nonce,
      permitAmount,
      expiration.toFixed()
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    expect((await aAGT.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    );

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    await expect(
      aAGT
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, expiration, v, r, s)
    ).to.be.revertedWith('INVALID_EXPIRATION');

    expect((await aAGT.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_AFTER_PERMIT'
    );
  });

  it('Submits a permit with maximum expiration length', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aAGT._nonces(owner.address)).toNumber();
    const permitAmount = parseEther('2').toString();
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      await aAGT.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    expect((await aAGT.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    );

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    await waitForTx(
      await aAGT
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    );

    expect((await aAGT._nonces(owner.address)).toNumber()).to.be.equal(1);
  });

  it('Cancels the previous permit', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aAGT._nonces(owner.address)).toNumber();
    const permitAmount = '0';
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      await aAGT.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    expect((await aAGT.allowance(owner.address, spender.address)).toString()).to.be.equal(
      ethers.utils.parseEther('2'),
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    );

    await waitForTx(
      await aAGT
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    );
    expect((await aAGT.allowance(owner.address, spender.address)).toString()).to.be.equal(
      permitAmount,
      'INVALID_ALLOWANCE_AFTER_PERMIT'
    );

    expect((await aAGT._nonces(owner.address)).toNumber()).to.be.equal(2);
  });

  it('Tries to submit a permit with invalid nonce', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = 1000;
    const permitAmount = '0';
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      await aAGT.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    await expect(
      aAGT
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_SIGNATURE');
  });

  it('Tries to submit a permit with invalid expiration (previous to the current block)', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const expiration = '1';
    const nonce = (await aAGT._nonces(owner.address)).toNumber();
    const permitAmount = '0';
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      await aAGT.name(),
      owner.address,
      spender.address,
      nonce,
      expiration,
      permitAmount
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    await expect(
      aAGT
        .connect(spender.signer)
        .permit(owner.address, spender.address, expiration, permitAmount, v, r, s)
    ).to.be.revertedWith('INVALID_EXPIRATION');
  });

  it('Tries to submit a permit with invalid signature', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aAGT._nonces(owner.address)).toNumber();
    const permitAmount = '0';
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      await aAGT.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    await expect(
      aAGT
        .connect(spender.signer)
        .permit(owner.address, ZERO_ADDRESS, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_SIGNATURE');
  });

  it('Tries to submit a permit with invalid owner', async () => {
    const { aAGT, deployer, users } = testEnv;
    const owner = deployer;
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const expiration = MAX_UINT_AMOUNT;
    const nonce = (await aAGT._nonces(owner.address)).toNumber();
    const permitAmount = '0';
    const msgParams = buildPermitParams(
      chainId,
      aAGT.address,
      '1',
      await aAGT.name(),
      owner.address,
      spender.address,
      nonce,
      expiration,
      permitAmount
    );

    const ownerPrivateKey = require('../../test-wallets.js').accounts[0].secretKey;
    if (!ownerPrivateKey) {
      throw new Error('INVALID_OWNER_PK');
    }

    const { v, r, s } = getSignatureFromTypedData(ownerPrivateKey, msgParams);

    await expect(
      aAGT
        .connect(spender.signer)
        .permit(ZERO_ADDRESS, spender.address, expiration, permitAmount, v, r, s)
    ).to.be.revertedWith('INVALID_OWNER');
  });
});
