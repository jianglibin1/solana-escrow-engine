#!/usr/bin/env npx ts-node

import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Load IDL
const IDL_PATH = path.join(__dirname, "../../target/idl/escrow_engine.json");

function loadWallet(keypairPath?: string): anchor.web3.Keypair {
  const p =
    keypairPath ||
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config/solana/id.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

function getProvider(
  cluster?: string
): { provider: anchor.AnchorProvider; wallet: anchor.web3.Keypair } {
  const url =
    cluster || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const wallet = loadWallet();
  const connection = new anchor.web3.Connection(url, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  return { provider, wallet };
}

function getProgram(provider: anchor.AnchorProvider): anchor.Program {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  return new anchor.Program(idl, provider);
}

function deriveEscrowPda(
  depositor: anchor.web3.PublicKey,
  escrowId: anchor.BN,
  programId: anchor.web3.PublicKey
) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      depositor.toBuffer(),
      escrowId.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

function deriveVaultPda(
  escrowPda: anchor.web3.PublicKey,
  programId: anchor.web3.PublicKey
) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrowPda.toBuffer()],
    programId
  );
}

function deriveVaultAuthorityPda(
  escrowPda: anchor.web3.PublicKey,
  programId: anchor.web3.PublicKey
) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), escrowPda.toBuffer()],
    programId
  );
}

const program_cmd = new Command();

program_cmd
  .name("escrow-cli")
  .description("CLI client for the On-Chain Escrow Engine")
  .version("0.1.0");

// ---- Create a test mint and token accounts ----
program_cmd
  .command("setup-test")
  .description("Create a test SPL mint and token accounts, mint tokens to depositor")
  .option("-a, --amount <number>", "Amount to mint", "10000000")
  .action(async (opts) => {
    const { provider, wallet } = getProvider();
    const amount = parseInt(opts.amount);

    console.log("Creating test mint...");
    const mint = await createMint(
      provider.connection,
      wallet,
      wallet.publicKey,
      null,
      6
    );
    console.log("Mint:", mint.toBase58());

    const tokenAccount = await createAccount(
      provider.connection,
      wallet,
      mint,
      wallet.publicKey
    );
    console.log("Token account:", tokenAccount.toBase58());

    await mintTo(
      provider.connection,
      wallet,
      mint,
      tokenAccount,
      wallet,
      amount
    );
    console.log(`Minted ${amount} tokens`);

    // Save to a local state file
    const state = { mint: mint.toBase58(), tokenAccount: tokenAccount.toBase58() };
    fs.writeFileSync(
      path.join(__dirname, "../../.escrow-state.json"),
      JSON.stringify(state, null, 2)
    );
    console.log("State saved to .escrow-state.json");
  });

// ---- Initialize Escrow ----
program_cmd
  .command("init")
  .description("Initialize a new escrow")
  .requiredOption("-i, --id <number>", "Escrow ID")
  .requiredOption("-b, --beneficiary <pubkey>", "Beneficiary public key")
  .requiredOption("-r, --arbiter <pubkey>", "Arbiter public key")
  .requiredOption("-m, --mint <pubkey>", "Token mint")
  .requiredOption("-a, --amount <number>", "Escrow amount")
  .option("-s, --auto-release-slot <number>", "Auto-release slot (optional)")
  .action(async (opts) => {
    const { provider, wallet } = getProvider();
    const prog = getProgram(provider);

    const escrowId = new anchor.BN(opts.id);
    const amount = new anchor.BN(opts.amount);
    const beneficiary = new anchor.web3.PublicKey(opts.beneficiary);
    const arbiter = new anchor.web3.PublicKey(opts.arbiter);
    const mint = new anchor.web3.PublicKey(opts.mint);
    const autoReleaseSlot = opts.autoReleaseSlot
      ? new anchor.BN(opts.autoReleaseSlot)
      : null;

    const [escrowPda] = deriveEscrowPda(wallet.publicKey, escrowId, prog.programId);
    const [vaultPda] = deriveVaultPda(escrowPda, prog.programId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(escrowPda, prog.programId);

    console.log("Initializing escrow...");
    console.log("  Escrow PDA:", escrowPda.toBase58());

    const tx = await prog.methods
      .initializeEscrow(escrowId, amount, autoReleaseSlot)
      .accounts({
        depositor: wallet.publicKey,
        beneficiary,
        arbiter,
        mint,
        escrow: escrowPda,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([wallet])
      .rpc();

    console.log("  Tx:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  });

// ---- Fund Escrow ----
program_cmd
  .command("fund")
  .description("Fund an escrow")
  .requiredOption("-i, --id <number>", "Escrow ID")
  .requiredOption("-t, --token-account <pubkey>", "Depositor token account")
  .action(async (opts) => {
    const { provider, wallet } = getProvider();
    const prog = getProgram(provider);

    const escrowId = new anchor.BN(opts.id);
    const [escrowPda] = deriveEscrowPda(wallet.publicKey, escrowId, prog.programId);
    const [vaultPda] = deriveVaultPda(escrowPda, prog.programId);

    console.log("Funding escrow...");
    const tx = await prog.methods
      .fundEscrow()
      .accounts({
        depositor: wallet.publicKey,
        escrow: escrowPda,
        depositorToken: new anchor.web3.PublicKey(opts.tokenAccount),
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([wallet])
      .rpc();

    console.log("  Tx:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  });

// ---- Release Funds ----
program_cmd
  .command("release")
  .description("Release funds to beneficiary")
  .requiredOption("-i, --id <number>", "Escrow ID")
  .requiredOption("-t, --beneficiary-token <pubkey>", "Beneficiary token account")
  .action(async (opts) => {
    const { provider, wallet } = getProvider();
    const prog = getProgram(provider);

    const escrowId = new anchor.BN(opts.id);
    const [escrowPda] = deriveEscrowPda(wallet.publicKey, escrowId, prog.programId);
    const [vaultPda] = deriveVaultPda(escrowPda, prog.programId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(escrowPda, prog.programId);

    console.log("Releasing funds...");
    const tx = await prog.methods
      .releaseFunds()
      .accounts({
        depositor: wallet.publicKey,
        escrow: escrowPda,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        beneficiaryToken: new anchor.web3.PublicKey(opts.beneficiaryToken),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([wallet])
      .rpc();

    console.log("  Tx:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  });

// ---- Dispute ----
program_cmd
  .command("dispute")
  .description("Raise a dispute on an escrow")
  .requiredOption("-i, --id <number>", "Escrow ID")
  .requiredOption("-d, --depositor <pubkey>", "Depositor public key (for PDA derivation)")
  .requiredOption("--reason <string>", "Dispute reason")
  .action(async (opts) => {
    const { provider, wallet } = getProvider();
    const prog = getProgram(provider);

    const escrowId = new anchor.BN(opts.id);
    const depositor = new anchor.web3.PublicKey(opts.depositor);
    const [escrowPda] = deriveEscrowPda(depositor, escrowId, prog.programId);

    console.log("Raising dispute...");
    const tx = await prog.methods
      .raiseDispute(opts.reason)
      .accounts({
        party: wallet.publicKey,
        escrow: escrowPda,
      })
      .signers([wallet])
      .rpc();

    console.log("  Tx:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  });

// ---- View Escrow ----
program_cmd
  .command("view")
  .description("View escrow details")
  .requiredOption("-i, --id <number>", "Escrow ID")
  .requiredOption("-d, --depositor <pubkey>", "Depositor public key")
  .action(async (opts) => {
    const { provider } = getProvider();
    const prog = getProgram(provider);

    const escrowId = new anchor.BN(opts.id);
    const depositor = new anchor.web3.PublicKey(opts.depositor);
    const [escrowPda] = deriveEscrowPda(depositor, escrowId, prog.programId);

    try {
      const escrow = await prog.account.escrowAccount.fetch(escrowPda);
      console.log("\n=== Escrow #" + opts.id + " ===");
      console.log("  PDA:            ", escrowPda.toBase58());
      console.log("  Depositor:      ", escrow.depositor.toBase58());
      console.log("  Beneficiary:    ", escrow.beneficiary.toBase58());
      console.log("  Arbiter:        ", escrow.arbiter.toBase58());
      console.log("  Mint:           ", escrow.mint.toBase58());
      console.log("  Amount:         ", escrow.amount.toString());
      console.log("  Status:         ", JSON.stringify(escrow.status));
      console.log("  Auto-release:   ", escrow.autoReleaseSlot.toString());
      console.log("  Created at slot:", escrow.createdAtSlot.toString());
      console.log("  Updated at slot:", escrow.updatedAtSlot.toString());
      if (escrow.disputeReason) {
        console.log("  Dispute reason: ", escrow.disputeReason);
      }
    } catch (e: any) {
      console.error("Escrow not found or error:", e.message);
    }
  });

program_cmd.parse(process.argv);
