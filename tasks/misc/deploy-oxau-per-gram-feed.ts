import { task } from 'hardhat/config';

task('deploy-oxau-per-gram-feed', 'Deploys the ounce-to-gram wrapper feed for OXAU')
  .addParam('ozFeed', 'Underlying ounce-denominated Chainlink-style feed address')
  .addFlag('verify', 'Verify deployed contract via explorer API')
  .setAction(async ({ ozFeed, verify }, hre) => {
    await hre.run('set-DRE');

    const factory = await hre.ethers.getContractFactory('OXAUPerGramFeed');
    const wrapper = await factory.deploy(ozFeed);
    await wrapper.deployTransaction.wait(1);

    console.log(`OZ feed: ${ozFeed}`);
    console.log(`OXAUPerGramFeed: ${wrapper.address}`);

    if (verify) {
      await hre.run('verify:verify', {
        address: wrapper.address,
        contract: 'contracts/misc/OXAUPerGramFeed.sol:OXAUPerGramFeed',
        constructorArguments: [ozFeed],
      });
    }
  });
