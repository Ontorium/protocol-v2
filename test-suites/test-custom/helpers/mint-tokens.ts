import hre from 'hardhat';

// 토큰을 많이 보유한 주소 (테스트넷에서 토큰 전송용)
const TOKEN_WHALE_ADDRESS = '0xdD6CB87f7D7a558D7fd89d9C8F5c19501cEF9bed';

// RPC URL helper - HARDHAT_NETWORK_URL 환경변수 지원
function getRpcUrl(): string {
  return process.env.HARDHAT_NETWORK_URL || 'http://localhost:8545';
}

/**
 * Helper function to mint tokens in USE_DEPLOYED mode
 * Uses Anvil impersonation to transfer tokens from whale address
 * Uses direct JsonRpcProvider for impersonation, then syncs state
 */
export async function mintTokens(
  token: any,
  recipient: string,
  amount: any,
  recipientSigner: any
): Promise<void> {
  if (process.env.USE_DEPLOYED) {
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

    const tokenAbi = [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address,uint256) external returns (bool)',
      'function minters() view returns (address[])',
      'function mint(address,uint256) external',
    ];

    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    const tokenContract = new hre.ethers.Contract(token.address, tokenAbi, directProvider);

    // AGT 토큰인 경우 minters 함수를 통해 mint
    let isGoldToken = false;
    let minterAddress: string | null = null;

    try {
      const minters = await tokenContract.minters();
      if (minters && minters.length > 0) {
        isGoldToken = true;
        minterAddress = minters[0];
      }
    } catch (e) {
      // Not a GoldToken (AGT)
    }

    if (isGoldToken && minterAddress) {
      // AGT: minter를 통해 mint
      await directProvider.send('anvil_impersonateAccount', [minterAddress]);
      await directProvider.send('anvil_setBalance', [minterAddress, '0x56BC75E2D63100000']);

      const minterSigner = directProvider.getSigner(minterAddress);
      // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
      const tokenWithMinter = new hre.ethers.Contract(token.address, tokenAbi, minterSigner);

      const tx = await tokenWithMinter['mint(address,uint256)'](recipient, amount);
      await tx.wait();
      await directProvider.send('anvil_stopImpersonatingAccount', [minterAddress]);
    } else {
      // USDC/USDT: whale 주소에서 transfer
      const whaleBalance = await tokenContract.balanceOf(TOKEN_WHALE_ADDRESS);

      if (whaleBalance.gte(amount)) {
        // Whale 주소에서 전송
        await directProvider.send('anvil_impersonateAccount', [TOKEN_WHALE_ADDRESS]);
        await directProvider.send('anvil_setBalance', [TOKEN_WHALE_ADDRESS, '0x56BC75E2D63100000']);

        const whaleSigner = directProvider.getSigner(TOKEN_WHALE_ADDRESS);
        // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
        const tokenWithWhale = new hre.ethers.Contract(token.address, tokenAbi, whaleSigner);

        const tx = await tokenWithWhale.transfer(recipient, amount);
        await tx.wait();
        await directProvider.send('anvil_stopImpersonatingAccount', [TOKEN_WHALE_ADDRESS]);
      } else {
        throw new Error(`Whale address ${TOKEN_WHALE_ADDRESS} does not have enough balance for token ${token.address}. Has: ${whaleBalance.toString()}, needs: ${amount.toString()}`);
      }
    }

    // Mine a block to ensure state is committed and visible to all providers
    await directProvider.send('evm_mine', []);

    // Verify the balance was updated by waiting for the state to sync
    const finalBalance = await tokenContract.balanceOf(recipient);
    if (finalBalance.lt(amount)) {
      // Retry mining if balance not yet visible
      await directProvider.send('evm_mine', []);
    }
  } else {
    // Local mode - direct mint
    await token.connect(recipientSigner).mint(amount);
  }
}

/**
 * Helper to execute a transaction with staticCall pre-check
 * Improves stability on Anvil fork
 */
export async function safeExecute(
  contract: any,
  method: string,
  args: any[],
  signer: any
): Promise<any> {
  // First do a staticCall to check if transaction will succeed
  await contract.connect(signer).callStatic[method](...args);

  // If staticCall succeeded, execute the actual transaction
  const tx = await contract.connect(signer)[method](...args);
  await tx.wait();
  return tx;
}

/**
 * Helper to get admin signer by impersonating the pool admin
 * USE_DEPLOYED 모드에서 admin 권한이 필요한 테스트에 사용
 */
export async function getAdminSigner(addressesProvider: any): Promise<any> {
  // AddressesProvider에서 admin 주소 가져오기
  const adminAddress = await addressesProvider.getPoolAdmin();

  if (process.env.USE_DEPLOYED) {
    // USE_DEPLOYED 모드: anvil fork 사용
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
    await directProvider.send('anvil_impersonateAccount', [adminAddress]);
    await directProvider.send('anvil_setBalance', [adminAddress, '0x56BC75E2D63100000']); // 100 ETH
    // impersonate한 동일한 provider에서 signer 반환
    return directProvider.getSigner(adminAddress);
  } else {
    // 로컬 hardhat 모드: hardhat impersonation 사용
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [adminAddress],
    });
    await hre.network.provider.send('hardhat_setBalance', [adminAddress, '0x56BC75E2D63100000']);
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    return await hre.ethers.getSigner(adminAddress);
  }
}

/**
 * Helper to stop impersonating admin
 */
export async function stopImpersonatingAdmin(addressesProvider: any): Promise<void> {
  const adminAddress = await addressesProvider.getPoolAdmin();

  if (process.env.USE_DEPLOYED) {
    const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
    await directProvider.send('anvil_stopImpersonatingAccount', [adminAddress]);
  } else {
    await hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [adminAddress],
    });
  }
}

/**
 * Helper to get emergency admin signer by impersonating
 * USE_DEPLOYED 모드에서 emergency admin 권한이 필요한 테스트에 사용 (setPoolPause 등)
 */
export async function getEmergencyAdminSigner(addressesProvider: any): Promise<any> {
  // AddressesProvider에서 emergency admin 주소 가져오기
  const emergencyAdminAddress = await addressesProvider.getEmergencyAdmin();

  if (!process.env.USE_DEPLOYED) {
    // 로컬 모드에서는 해당 주소로 signer 가져오기
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    return await hre.ethers.getSigner(emergencyAdminAddress);
  }

  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Emergency Admin 계정 impersonate
  await directProvider.send('anvil_impersonateAccount', [emergencyAdminAddress]);
  await directProvider.send('anvil_setBalance', [emergencyAdminAddress, '0x56BC75E2D63100000']); // 100 ETH

  return directProvider.getSigner(emergencyAdminAddress);
}

/**
 * Helper to stop impersonating emergency admin
 */
export async function stopImpersonatingEmergencyAdmin(addressesProvider: any): Promise<void> {
  if (!process.env.USE_DEPLOYED) {
    return;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
  const emergencyAdminAddress = await addressesProvider.getEmergencyAdmin();
  await directProvider.send('anvil_stopImpersonatingAccount', [emergencyAdminAddress]);
}

/**
 * Helper to get oracle owner address from MNEMONIC
 * PriceOracle 컨트랙트는 owner() 함수가 없으므로 MNEMONIC에서 deployer 주소를 파생
 */
function getDeployerAddressFromMnemonic(): string {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    throw new Error('MNEMONIC not set in environment variables');
  }
  const hdNode = hre.ethers.utils.HDNode.fromMnemonic(mnemonic);
  const derivedNode = hdNode.derivePath("m/44'/60'/0'/0/0");
  return derivedNode.address;
}

/**
 * Helper to get oracle owner signer by impersonating
 * USE_DEPLOYED 모드에서 oracle 가격 조작이 필요한 테스트에 사용
 * PriceOracle은 owner() 함수가 없으므로 MNEMONIC에서 deployer 주소를 사용
 */
export async function getOracleOwnerSigner(oracle: any): Promise<any> {
  if (!process.env.USE_DEPLOYED) {
    const [deployer] = await hre.ethers.getSigners();
    return deployer;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // MNEMONIC에서 deployer(owner) 주소 파생
  const ownerAddress = getDeployerAddressFromMnemonic();

  // Owner 계정 impersonate
  await directProvider.send('anvil_impersonateAccount', [ownerAddress]);
  await directProvider.send('anvil_setBalance', [ownerAddress, '0x56BC75E2D63100000']);

  return directProvider.getSigner(ownerAddress);
}

/**
 * Helper to stop impersonating oracle owner
 */
export async function stopImpersonatingOracleOwner(oracle: any): Promise<void> {
  if (!process.env.USE_DEPLOYED) {
    return;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
  const ownerAddress = getDeployerAddressFromMnemonic();
  await directProvider.send('anvil_stopImpersonatingAccount', [ownerAddress]);
}

/**
 * Helper to get AddressesProvider owner signer by impersonating
 * USE_DEPLOYED 모드에서 AddressesProvider owner 권한이 필요한 테스트에 사용
 */
export async function getAddressesProviderOwnerSigner(addressesProvider: any): Promise<any> {
  if (!process.env.USE_DEPLOYED) {
    const [deployer] = await hre.ethers.getSigners();
    return deployer;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // AddressesProvider에서 owner 주소 가져오기
  const ownerAddress = await addressesProvider.owner();

  // Owner 계정 impersonate
  await directProvider.send('anvil_impersonateAccount', [ownerAddress]);
  await directProvider.send('anvil_setBalance', [ownerAddress, '0x56BC75E2D63100000']); // 100 ETH

  return directProvider.getSigner(ownerAddress);
}

/**
 * Helper to stop impersonating AddressesProvider owner
 */
export async function stopImpersonatingAddressesProviderOwner(addressesProvider: any): Promise<void> {
  if (!process.env.USE_DEPLOYED) {
    return;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
  const ownerAddress = await addressesProvider.owner();
  await directProvider.send('anvil_stopImpersonatingAccount', [ownerAddress]);
}

/**
 * Helper to get Registry owner signer by impersonating
 * USE_DEPLOYED 모드에서 Registry owner 권한이 필요한 테스트에 사용
 */
export async function getRegistryOwnerSigner(registry: any): Promise<any> {
  if (!process.env.USE_DEPLOYED) {
    const [deployer] = await hre.ethers.getSigners();
    return deployer;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Registry에서 owner 주소 가져오기
  const ownerAddress = await registry.owner();

  // Owner 계정 impersonate
  await directProvider.send('anvil_impersonateAccount', [ownerAddress]);
  await directProvider.send('anvil_setBalance', [ownerAddress, '0x56BC75E2D63100000']); // 100 ETH

  return directProvider.getSigner(ownerAddress);
}

/**
 * Helper to stop impersonating Registry owner
 */
export async function stopImpersonatingRegistryOwner(registry: any): Promise<void> {
  if (!process.env.USE_DEPLOYED) {
    return;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
  const ownerAddress = await registry.owner();
  await directProvider.send('anvil_stopImpersonatingAccount', [ownerAddress]);
}

/**
 * Helper to set asset price in AaveOracle via MockAggregator storage manipulation
 * USE_DEPLOYED 모드에서 MockAggregator의 _latestAnswer를 직접 수정
 * @param oracle AaveOracle contract
 * @param asset Asset address
 * @param newPrice New price (in wei, 18 decimals)
 */
export async function setAggregatorPrice(oracle: any, asset: string, newPrice: string): Promise<void> {
  if (!process.env.USE_DEPLOYED) {
    // 로컬 모드에서는 PriceOracle.setAssetPrice 직접 호출
    await oracle.setAssetPrice(asset, newPrice);
    return;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // AaveOracle에서 asset의 aggregator 주소 가져오기
  const oracleAbi = ['function getSourceOfAsset(address) view returns (address)'];
  const oracleContract = new hre.ethers.Contract(oracle.address, oracleAbi, directProvider);

  const aggregatorAddress = await oracleContract.getSourceOfAsset(asset);

  if (aggregatorAddress === hre.ethers.constants.AddressZero) {
    throw new Error(`No aggregator found for asset ${asset}`);
  }

  // MockAggregator의 _latestAnswer는 slot 0에 저장됨
  // int256 타입이므로 음수 처리는 필요하지 않음 (가격은 항상 양수)
  const slot = '0x0';
  const value = hre.ethers.utils.hexZeroPad(hre.ethers.BigNumber.from(newPrice).toHexString(), 32);

  // Retry logic for reliability on Anvil fork
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await directProvider.send('anvil_setStorageAt', [aggregatorAddress, slot, value]);

    // Mine a block to ensure storage change is committed
    await directProvider.send('evm_mine', []);

    // Verify the price was updated
    const aggregatorAbi = ['function latestAnswer() view returns (int256)'];
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    const aggregator = new hre.ethers.Contract(aggregatorAddress, aggregatorAbi, directProvider);
    const actualPrice = await aggregator.latestAnswer();
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    if (actualPrice.eq(hre.ethers.BigNumber.from(newPrice))) {
      return; // Success
    }

    if (attempt === maxRetries) {
      throw new Error(`Failed to set aggregator price after ${maxRetries} attempts. Expected ${newPrice}, got ${actualPrice.toString()}`);
    }

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
