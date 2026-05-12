import { task } from 'hardhat/config';
import { waitForTx } from '../../helpers/misc-utils';
import { getAaveOracle } from '../../helpers/contracts-getters';

task(
  'set-aave-oracle-source',
  'Registers or updates a single asset source on an existing AaveOracle'
)
  .addParam('oracle', 'AaveOracle address')
  .addParam('asset', 'Underlying asset address')
  .addParam('source', 'Chainlink aggregator address')
  .setAction(async ({ oracle, asset, source }, hre) => {
    await hre.run('set-DRE');

    const aaveOracle = await getAaveOracle(oracle);
    const currentSource = await aaveOracle.getSourceOfAsset(asset);

    if (currentSource.toLowerCase() === source.toLowerCase()) {
      console.log(`Source already set for ${asset}: ${currentSource}`);
      return;
    }

    const tx = await aaveOracle.setAssetSources([asset], [source]);
    await waitForTx(tx);

    const updatedSource = await aaveOracle.getSourceOfAsset(asset);
    console.log(`AaveOracle: ${oracle}`);
    console.log(`Asset: ${asset}`);
    console.log(`Source: ${updatedSource}`);
  });
