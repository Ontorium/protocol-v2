import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../../helpers/constants';
import { BUIDLEREVM_CHAINID } from '../../helpers/buidler-constants';
import { buildPermitParams } from '../../helpers/contracts-helpers';
import { expect } from 'chai';
import { ethers } from 'ethers';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { DRE } from '../../helpers/misc-utils';
import { waitForTx } from '../../helpers/misc-utils';
import { _TypedDataEncoder } from 'ethers/lib/utils';
import { mintTokens } from './helpers/mint-tokens';

const { parseEther } = ethers.utils;

async function signPermitFromSigner(signer: any, msgParams: any) {
  const types = { Permit: msgParams.types.Permit }; // exclude EIP712Domain
  const signature = await signer._signTypedData(msgParams.domain, types, msgParams.message);
  return ethers.utils.splitSignature(signature);
}

makeSuite('AToken: Permit', (testEnv: TestEnv) => {
  it('Checks the domain separator', async () => {
    const { aOXAU } = testEnv;
    const separator = await aOXAU.DOMAIN_SEPARATOR();

    const domain = {
      name: await aOXAU.name(),
      version: '1',
      chainId: DRE.network.config.chainId,
      verifyingContract: aOXAU.address,
    };
    const domainSeparator = _TypedDataEncoder.hashDomain(domain);

    expect(separator).to.be.equal(domainSeparator, 'Invalid domain separator');
  });

  it('Get aOXAU for tests', async () => {
    const { oxau, pool, deployer } = testEnv;
    const amount = parseEther('20000');

    await mintTokens(oxau, deployer.address, amount, deployer.signer);
    await oxau.approve(pool.address, amount);

    await waitForTx(
      await pool.deposit(oxau.address, amount, deployer.address, 0)
    );
  });

  it('Reverts submitting a permit with 0 expiration', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const tokenName = await aOXAU.name();
    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;

    const deadline = 0;
    const nonce = (await aOXAU._nonces(owner.address)).toNumber();
    const permitAmount = parseEther('2').toString();

    // buildPermitParams expects (deadline, value) at the end (same as original tests)
    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      tokenName,
      owner.address,
      spender.address,
      nonce,
      deadline.toString(),
      permitAmount
    );

    expect((await aOXAU.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    await expect(
      aOXAU
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_EXPIRATION');

    expect((await aOXAU.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_AFTER_PERMIT'
    );
  });

  it('Submits a permit with maximum expiration length', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aOXAU._nonces(owner.address)).toNumber();
    const permitAmount = parseEther('2').toString();

    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      await aOXAU.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    expect((await aOXAU.allowance(owner.address, spender.address)).toString()).to.be.equal(
      '0',
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    await waitForTx(
      await aOXAU
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    );

    expect((await aOXAU._nonces(owner.address)).toNumber()).to.be.equal(1);
  });

  it('Cancels the previous permit', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aOXAU._nonces(owner.address)).toNumber();
    const permitAmount = '0';

    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      await aOXAU.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    expect((await aOXAU.allowance(owner.address, spender.address)).toString()).to.be.equal(
      parseEther('2').toString(),
      'INVALID_ALLOWANCE_BEFORE_PERMIT'
    );

    await waitForTx(
      await aOXAU
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    );

    expect((await aOXAU.allowance(owner.address, spender.address)).toString()).to.be.equal(
      permitAmount,
      'INVALID_ALLOWANCE_AFTER_PERMIT'
    );

    expect((await aOXAU._nonces(owner.address)).toNumber()).to.be.equal(2);
  });

  it('Tries to submit a permit with invalid nonce', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = 1000;
    const permitAmount = '0';

    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      await aOXAU.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    await expect(
      aOXAU
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_SIGNATURE');
  });

  it('Tries to submit a permit with invalid expiration (previous to the current block)', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = '1'; // in the past
    const nonce = (await aOXAU._nonces(owner.address)).toNumber();
    const permitAmount = '0';

    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      await aOXAU.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    await expect(
      aOXAU
        .connect(spender.signer)
        .permit(owner.address, spender.address, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_EXPIRATION');
  });

  it('Tries to submit a permit with invalid signature', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aOXAU._nonces(owner.address)).toNumber();
    const permitAmount = '0';

    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      await aOXAU.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    await expect(
      aOXAU
        .connect(spender.signer)
        .permit(owner.address, ZERO_ADDRESS, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_SIGNATURE');
  });

  it('Tries to submit a permit with invalid owner', async () => {
    const { aOXAU, users } = testEnv;
    const owner = users[0];
    const spender = users[1];

    const chainId = DRE.network.config.chainId || BUIDLEREVM_CHAINID;
    const deadline = MAX_UINT_AMOUNT;
    const nonce = (await aOXAU._nonces(owner.address)).toNumber();
    const permitAmount = '0';

    const msgParams = buildPermitParams(
      chainId,
      aOXAU.address,
      '1',
      await aOXAU.name(),
      owner.address,
      spender.address,
      nonce,
      deadline,
      permitAmount
    );

    const { v, r, s } = await signPermitFromSigner(owner.signer, msgParams);

    await expect(
      aOXAU
        .connect(spender.signer)
        .permit(ZERO_ADDRESS, spender.address, permitAmount, deadline, v, r, s)
    ).to.be.revertedWith('INVALID_OWNER');
  });
});
