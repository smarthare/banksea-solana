const assert = require('assert');
const anchor = require('@project-serum/anchor');

describe('banksy transfer without authority', () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());
  // Program for the tests.
  const program = anchor.workspace.Banksy;

  let nftAccount = null;
  let user1Wallet = anchor.web3.Keypair.generate();
  let user2Wallet = anchor.web3.Keypair.generate();
  let user3Wallet = anchor.web3.Keypair.generate();

  it('Create a nft', async () => {
    const uri = "ipfs://ipfs/QmVLAo3EQvkkQKjLTt1dawYsehSEnwYBi19vzh85pohpuw";
    const supply = new anchor.BN(100);
    

    nftAccount = await createNftAccount(program, uri, supply, user1Wallet);
    
    const nftAccountInfo = await getNftAccountInfo(program, nftAccount);

    assert.ok(nftAccountInfo.supply.toNumber() === supply.toNumber());
    assert.ok(nftAccountInfo.uri === uri);



    const user1Account = await findUserAccount(program, user1Wallet.publicKey, nftAccount);
    const user1AccountInfo = await getUserAccountInfo(program, user1Account);

    assert.ok(user1AccountInfo.amount.toNumber() === supply.toNumber());
    assert.ok(user1AccountInfo.authority.equals(user1Wallet.publicKey));
    assert.ok(user1AccountInfo.nft.equals(nftAccount));
  });




  it('transfer', async () => {
    const amount = new anchor.BN(10);

    const user1Account = await findUserAccount(program, user1Wallet.publicKey, nftAccount);
    const user2Account = await findUserAccount(program, user2Wallet.publicKey, nftAccount);


    assert.ok(await expectThrow(program.rpc.transfer(amount, {
      accounts: {
        from: user1Account,
        to: user2Account,
        authority: user1Wallet.publicKey,
      },
      signers: [user3Wallet]
    })));

    const user1AccountInfo = await getUserAccountInfo(program, user1Account);
    const user2AccountInfo = await getUserAccountInfo(program, user2Account);

    assert.ok(user1AccountInfo.amount.toNumber() === 100);
    assert.ok(user1AccountInfo.authority.equals(user1Wallet.publicKey));
    assert.ok(user1AccountInfo.nft.equals(nftAccount));


    assert.ok(user2AccountInfo.amount.toNumber() === 0);
    assert.ok(user2AccountInfo.authority.equals(user2Wallet.publicKey));
    assert.ok(user2AccountInfo.nft.equals(nftAccount));
  });

});

async function createNftAccount(program, uri, supply, userKey) {
  const nftKey = anchor.web3.Keypair.generate();
  const userAccount = await program.account.userAccount.associatedAddress(userKey.publicKey, nftKey.publicKey);
  // create a nft to a account
  

  await program.rpc.createNft(uri, supply, {
    accounts: {
      nft: nftKey.publicKey,
      authority: userKey.publicKey,
      user: userAccount,
      payer: program.provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
    signers: [nftKey, userKey],
    instructions: [await program.account.nftAccount.createInstruction(nftKey, 256)],
  });
  
  return nftKey.publicKey;
}


async function findUserAccount(program, userPublicKey, nftAccount) {
  // create a user account
  const associatedToken = await program.account.userAccount.associatedAddress(userPublicKey, nftAccount);
  const accountInfo = await program.provider.connection.getAccountInfo(associatedToken);

  if(accountInfo == null) {
    await program.rpc.createUser({
      accounts: {
        nft: nftAccount,
        payer: program.provider.wallet.publicKey,
        user: associatedToken,
        authority: userPublicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
    });
  }

  return associatedToken;
}


async function getNftAccountInfo(program, nftAccount) {
  return await program.account.nftAccount.fetch(nftAccount);
}

async function getUserAccountInfo(program, userAccount) {
  return await program.account.userAccount.fetch(userAccount);
}

async function expectThrow(promise) {
  let error = false;
  console.log = ()=>{}
  try {
    await promise;
  }
  catch (err) {
    error = true;
  }
  return error;
}