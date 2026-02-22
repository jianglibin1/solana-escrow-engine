use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{EscrowAccount, EscrowStatus};
use crate::errors::EscrowError;

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        has_one = depositor @ EscrowError::UnauthorizedDepositor,
        constraint = escrow.status == EscrowStatus::Created @ EscrowError::InvalidState,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(
        mut,
        constraint = depositor_token.mint == escrow.mint,
        constraint = depositor_token.owner == depositor.key(),
    )]
    pub depositor_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault.key() == escrow.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<FundEscrow>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let amount = escrow.amount;

    // Transfer tokens from depositor to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_token.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    escrow.status = EscrowStatus::Funded;
    escrow.updated_at_slot = Clock::get()?.slot;

    msg!("Escrow {} funded with {} tokens", escrow.escrow_id, amount);

    Ok(())
}
