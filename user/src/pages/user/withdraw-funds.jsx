import { Button, Chip, Grid, InputLabel, MenuItem, Select, Stack, TextField, Typography, useTheme } from '@mui/material';
import CommonDatatable from 'helpers/CommonDatatable'
import { useEffect, useMemo, useState } from 'react'
import { openSnackbar } from 'api/snackbar';
import axios from 'utils/axios';
import Handler from 'myComponents/requests';
import Loader from 'components/Loader';
import { ethers } from 'ethers';
import Swal from 'sweetalert2';

export default function AddFunds() {

    const [isMobileDevice, setIsMobileDevice] = useState(false);

    const handleResize = () => {
        setIsMobileDevice(window.innerWidth <= 768); // You can adjust the width as needed
    }

    const apiPoint = 'get-all-withdrawals'

    const columns = useMemo(
        () => [
            {
                header: 'Address',
                accessorKey: 'address'
            },
            {
                header: 'Wallet Type',
                accessorKey: 'extra.walletType',
                cell: (props) => {
                    return props.getValue() ?? ''
                },
            },
            {
                header: 'USDT Amount',
                accessorKey: 'amount'
            },
            // {
            //     header: 'Tokens',
            //     accessorKey: 'net_amount',
            //     cell: (props) => {
            //         return props.getValue()?.toFixed(5) ?? 0
            //     },
            // },
            // {
            //     header: 'Coversion Rate',
            //     accessorKey: 'rate',
            //     cell: (props) => {
            //         return props.getValue()?.toFixed(5) ?? 0
            //     },
            // },
            {
                header: 'Status',
                accessorKey: 'status',
                enableColumnFilter: false,
                enableGrouping: false,
                cell: (props) => {
                    return <Chip color={props.getValue() === 1 ? "success" : "error"} label={props.getValue() === 1 ? "Success" : "Pending"} size="small" />
                },
            },
            {
                header: 'Date',
                accessorKey: 'created_at',
                // meta: { className: 'cell-right' }
                cell: (props) => {
                    return new Date(props.getValue()).toLocaleString();
                },
                enableColumnFilter: false,
                enableGrouping: false
            },
            // {
            //     header: 'TXN',
            //     accessorKey: 'txid',
            //     cell: (props) => {
            //         return <Chip color={props.getValue() !== null ? "success" : "error"} label={"Open Transaction"} size="small" onClick={() => window.open(`https://${process.env.VITE_APP_BLOCK_SCAN_URL}/tx/${props.getValue()}`, '_blank')} />
            //     }
            // }
        ],
        []
    )

    const [amount, setAmount] = useState()
    const [address, setAddress] = useState()
    const [walletType, setWalletType] = useState('wallet')

    const [user, setUser] = useState()
    const [tasksIncome, setTasksIncome] = useState()
    const [levelIncome, setLevelIncome] = useState()

    const [state, setState] = useState({
        loading : false,
        success : false,
        msg : ''
    });
    const contractABI = process.env.REACT_APP_CONTRACT_ABI;
    const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS
    useEffect(() => {
        let user = JSON.parse(window.localStorage.getItem('user'));
        if (user) {
            setUser(user)
            setAddress(user?.username)
            setTasksIncome(user?.wallet)
            setLevelIncome(user?.extra?.levelIncome)
        }
    }, [])
    const fixValue = Math.pow(10, 18)
   console.log("user", user)
    const handleTXN = async () => {
        try {
            if (!amount || amount <= 0) throw "Invalid amount!"
            if (amount > user?.wallet) throw "Amount must be less or equal than your balance!"
            if (!address || address.length <= 26) throw "Invalid address!"

            //
            const result = await Swal.fire({
                title: 'Confirm Withdrawal',
                text: `Are you sure you want to withdraw ${amount} USDT?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, withdraw!'
            });

            // If user confirms
            if (result) {
                setState({ loading: true, msg: "Processing withdrawal..." })
                  const provider = new ethers.providers.Web3Provider(window.ethereum);
                    console.log("withdraw")
                    await provider.send('eth_requestAccounts', []); 
                    const signer = provider.getSigner();
                    const contract = new ethers.Contract(contractAddress, contractABI, signer);
                    const usdTobnb = await contract.bnbToUsd(1)
                    const withdrawFee = ethers.utils.parseEther("0.5")
                    // const withdrawAmount = ((1 / Number(usdTobnb)) * fixValue).toFixed(0)
                    const withdrawAmount = await contract.usdToBnb(ethers.utils.parseUnits(amount.toString(), 18))
                    console.log("withdrawAmount", withdrawAmount)
                    const finalWithdrawAmount = withdrawAmount 
                    console.log(finalWithdrawAmount)
                  
                if(true){
                  
                    const tx = await contract.withdraw({ value : ethers.utils.parseEther("0.0016")})
                    await tx.wait()
                }
                await Handler({
                    url: `/add-withdrawal`,
                    data: {
                        amount,
                        net_amount :finalWithdrawAmount + "",
                        address : user.username,
                        walletType : 'wallet'
                    },
                    setState
                }).then(() => {
                    
                    setAmount('')
                    setAddress('')
                    setTasksIncome(old => old - parseFloat(amount))
                    setUser((old) => ({...old, wallet : old.wallet - parseFloat(amount)}))
                    
                    // Show success message
                    Swal.fire({
                        title: 'Success!',
                        text: 'Withdrawal processed successfully!',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    })

                }).catch((e) => {
                    console.error(e, finalWithdrawAmount)
                    Swal.fire({
                        title: 'Error!',
                        text: `Failed to process withdrawal. Please try again. ${e.message}`,
                        icon: 'error'
                    });
                });
            }

        } catch (e) {
            console.error(e)
            Swal.fire({
                title: 'Error!',
                text: `${e.message} || Something went Wrong`,
                icon: 'error'
            });
            setState({loading : false})
        }
    }
   console.log("user", user)


    return state.loading ? (
        <Loader />
    ) : (
        <>
            <Stack sx={{ pb: 3 }}>
                <Typography variant="subtitle1">
                    Wallet Balance: {process.env.VITE_APP_CURRENCY_TYPE}{tasksIncome ?? 0}
                    <br />
                    {/* Level Balance: {process.env.VITE_APP_CURRENCY_TYPE}{levelIncome ?? 0} */}
                </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={isMobileDevice ? 12 : 1.25} sx={{ pb: 3 }}>
                {/* <Stack>
                    <Select
                        fullWidth
                        id="wallet-type"
                        value={walletType}
                        onChange={(e) => setWalletType(e.target.value)}
                        autoFocus
                    >
                        <MenuItem key={1} value="wallet">Tasks Wallet</MenuItem>
                        <MenuItem key={2} value="levelIncome">Level Wallet</MenuItem>
                    </Select>

                </Stack> */}
                <Stack>
                    <TextField
                        fullWidth
                        id="personal-amount"
                        value={amount}
                        onChange={(e) => {setAmount(e.target.value) }}
                        placeholder="Enter Amount"
                        autoFocus
                    />
                </Stack>
                {/* <Stack>
                    <TextField
                        fullWidth
                        id="personal-address"
                        value={address}
                        onChange={(e) => { setAddress(e.target.value) }}
                        placeholder="Enter Address"
                        autoFocus
                    />
                </Stack> */}
                <Stack spacing={10}>
                    <Button variant="contained" onClick={handleTXN}>
                        Withdraw
                    </Button>
                </Stack>
            </Stack>

            <CommonDatatable columns={columns} apiPoint={apiPoint} type={1} />

        </>
    )
}
