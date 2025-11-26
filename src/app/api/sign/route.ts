// src/app/api/sign/route.ts
import { NextResponse } from 'next/server'
import { Wallet, keccak256, solidityPacked, getBytes } from 'ethers'

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY!

export async function POST(req: Request) {
  try {
    if (!CONTRACT_ADDRESS || !SIGNER_PRIVATE_KEY) {
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 },
      )
    }

    const { address, fid } = await req.json()

    if (!address || fid === undefined || fid === null) {
      return NextResponse.json(
        { error: 'Missing address or fid' },
        { status: 400 },
      )
    }

    const wallet = new Wallet(SIGNER_PRIVATE_KEY)

    // Sama seperti di Solidity:
    // keccak256(abi.encodePacked(address(this), msg.sender, fid))
    const packed = solidityPacked(
      ['address', 'address', 'uint256'],
      [CONTRACT_ADDRESS, address, BigInt(fid)],
    )
    const messageHash = keccak256(packed)

    // signMessage akan menambahkan Ethereum Signed Message prefix
    const signature = await wallet.signMessage(getBytes(messageHash))

    return NextResponse.json({ signature })
  } catch (err: any) {
    console.error('SIGN ERROR:', err)
    return NextResponse.json(
      { error: 'Failed to sign' },
      { status: 500 },
    )
  }
}
