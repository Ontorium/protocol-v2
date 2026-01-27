import hre from 'hardhat';

// Address holding large token balances (for token transfers on testnet)
const TOKEN_WHALE_ADDRESS = '0xdD6CB87f7D7a558D7fd89d9C8F5c19501cEF9bed';

// RPC URL helper - supports HARDHAT_NETWORK_URL environment variable
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

    // For AGT token, mint via minters function
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
      // AGT: Mint via minter
      await directProvider.send('anvil_impersonateAccount', [minterAddress]);
      await directProvider.send('anvil_setBalance', [minterAddress, '0x56BC75E2D63100000']);

      const minterSigner = directProvider.getSigner(minterAddress);
      // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
      const tokenWithMinter = new hre.ethers.Contract(token.address, tokenAbi, minterSigner);

      const tx = await tokenWithMinter['mint(address,uint256)'](recipient, amount);
      await tx.wait();
      await directProvider.send('anvil_stopImpersonatingAccount', [minterAddress]);
    } else {
      // USDC/USDT: Transfer from whale address
      const whaleBalance = await tokenContract.balanceOf(TOKEN_WHALE_ADDRESS);

      if (whaleBalance.gte(amount)) {
        // Transfer from whale address
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
 * Used in USE_DEPLOYED mode for tests requiring admin privileges
 */
export async function getAdminSigner(addressesProvider: any): Promise<any> {
  // Get admin address from AddressesProvider
  const adminAddress = await addressesProvider.getPoolAdmin();

  if (process.env.USE_DEPLOYED) {
    // USE_DEPLOYED mode: Use anvil fork
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());
    await directProvider.send('anvil_impersonateAccount', [adminAddress]);
    await directProvider.send('anvil_setBalance', [adminAddress, '0x56BC75E2D63100000']); // 100 ETH
    // Return signer from the same provider used for impersonation
    return directProvider.getSigner(adminAddress);
  } else {
    // Local hardhat mode: Use hardhat impersonation
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
 * Used in USE_DEPLOYED mode for tests requiring emergency admin privileges (setPoolPause, etc.)
 */
export async function getEmergencyAdminSigner(addressesProvider: any): Promise<any> {
  // Get emergency admin address from AddressesProvider
  const emergencyAdminAddress = await addressesProvider.getEmergencyAdmin();

  if (!process.env.USE_DEPLOYED) {
    // In local mode, get signer by address
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    return await hre.ethers.getSigner(emergencyAdminAddress);
  }

  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Impersonate Emergency Admin account
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
 * PriceOracle contract doesn't have owner() function, so derive deployer address from MNEMONIC
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
 * Used in USE_DEPLOYED mode for tests requiring oracle price manipulation
 * PriceOracle doesn't have owner() function, so uses deployer address from MNEMONIC
 */
export async function getOracleOwnerSigner(oracle: any): Promise<any> {
  if (!process.env.USE_DEPLOYED) {
    const [deployer] = await hre.ethers.getSigners();
    return deployer;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Derive deployer (owner) address from MNEMONIC
  const ownerAddress = getDeployerAddressFromMnemonic();

  // Impersonate Owner account
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
 * Used in USE_DEPLOYED mode for tests requiring AddressesProvider owner privileges
 */
export async function getAddressesProviderOwnerSigner(addressesProvider: any): Promise<any> {
  if (!process.env.USE_DEPLOYED) {
    const [deployer] = await hre.ethers.getSigners();
    return deployer;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Get owner address from AddressesProvider
  const ownerAddress = await addressesProvider.owner();

  // Impersonate Owner account
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
 * Used in USE_DEPLOYED mode for tests requiring Registry owner privileges
 */
export async function getRegistryOwnerSigner(registry: any): Promise<any> {
  if (!process.env.USE_DEPLOYED) {
    const [deployer] = await hre.ethers.getSigners();
    return deployer;
  }

  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Get owner address from Registry
  const ownerAddress = await registry.owner();

  // Impersonate Owner account
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
 * Helper to set asset price in AaveOracle by deploying a MockAggregator
 * and updating the oracle's asset source via setAssetSources
 * Also sets the fallback oracle price for price=0 scenarios
 * @param oracle AaveOracle contract
 * @param asset Asset address
 * @param newPrice New price (in wei, 18 decimals)
 */
export async function setAggregatorPrice(oracle: any, asset: string, newPrice: string): Promise<void> {
  if (!process.env.USE_DEPLOYED) {
    // In local mode, call PriceOracle.setAssetPrice directly
    await oracle.setAssetPrice(asset, newPrice);
    return;
  }

  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const directProvider = new hre.ethers.providers.JsonRpcProvider(getRpcUrl());

  // Get oracle info (owner, fallback oracle)
  const oracleAbi = [
    'function owner() view returns (address)',
    'function setAssetSources(address[] calldata assets, address[] calldata sources) external',
    'function getAssetPrice(address) view returns (uint256)',
    'function getFallbackOracle() view returns (address)'
  ];
  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const oracleContract = new hre.ethers.Contract(oracle.address, oracleAbi, directProvider);

  const ownerAddress = await oracleContract.owner();
  const fallbackOracleAddress = await oracleContract.getFallbackOracle();

  // Impersonate owner
  await directProvider.send('anvil_impersonateAccount', [ownerAddress]);
  await directProvider.send('anvil_setBalance', [ownerAddress, '0x56BC75E2D63100000']); // 100 ETH

  // If price is 0 or negative, we need to also set the fallback oracle price
  // because AaveOracle falls back when aggregator returns price <= 0
  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const priceValue = hre.ethers.BigNumber.from(newPrice);
  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  if (priceValue.lte(0) && fallbackOracleAddress !== hre.ethers.constants.AddressZero) {
    // Set fallback oracle price
    const fallbackOracleAbi = [
      'function setAssetPrice(address asset, uint256 price) external'
    ];
    // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
    const fallbackOracle = new hre.ethers.Contract(
      fallbackOracleAddress,
      fallbackOracleAbi,
      directProvider.getSigner(ownerAddress)
    );
    const fallbackTx = await fallbackOracle.setAssetPrice(asset, newPrice);
    await fallbackTx.wait();
  }

  // Deploy a new MockAggregator with the desired price
  const MockAggregatorArtifact = await hre.artifacts.readArtifact('MockAggregator');
  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const MockAggregatorFactory = new hre.ethers.ContractFactory(
    MockAggregatorArtifact.abi,
    MockAggregatorArtifact.bytecode,
    directProvider.getSigner(ownerAddress)
  );

  // Deploy MockAggregator with the new price
  const mockAggregator = await MockAggregatorFactory.deploy(newPrice);
  await mockAggregator.deployed();

  // Update oracle to use the new MockAggregator
  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  const oracleWithOwner = new hre.ethers.Contract(
    oracle.address,
    oracleAbi,
    directProvider.getSigner(ownerAddress)
  );
  const tx = await oracleWithOwner.setAssetSources([asset], [mockAggregator.address]);
  await tx.wait();

  await directProvider.send('anvil_stopImpersonatingAccount', [ownerAddress]);

  // Mine a block to ensure state is committed
  await directProvider.send('evm_mine', []);

  // Verify the price was updated
  const actualPrice = await oracleContract.getAssetPrice(asset);
  // @ts-ignore - hre.ethers exists at runtime via hardhat-ethers plugin
  if (!actualPrice.eq(hre.ethers.BigNumber.from(newPrice))) {
    throw new Error(`Failed to set aggregator price. Expected ${newPrice}, got ${actualPrice.toString()}`);
  }
}
