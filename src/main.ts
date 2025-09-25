import { db } from './firebaseConfig';
import { collection, addDoc, getDocs, Timestamp, query, orderBy } from 'firebase/firestore';

// --- TYPE DEFINITIONS ---
interface BillItem { id: string; name: string; quantity: number; rate: number; }
type PaymentMode = 'Cash' | 'Card' | 'UPI';
interface ReceiptData {
    receiptNumber: string;
    receiptDate: Timestamp;
    items: Omit<BillItem, 'id'>[];
    discount: number;
    paymentMode: PaymentMode;
    subtotal: number;
    grandTotal: number;
}

// --- STATE ---
let billItems: BillItem[] = [];
let allReceipts: ReceiptData[] = []; 
let pendingReceipt: ReceiptData | null = null; 

// --- UTILS ---
const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
const generateReceiptNumber = () => `AT-` + Date.now().toString().slice(-6);

// --- DOM ELEMENTS ---
const doc = document;
// Login elements
const loginContainer = doc.getElementById('login-container')!;
const loginForm = doc.getElementById('login-form') as HTMLFormElement;
const loginError = doc.getElementById('login-error')!;
// App elements
const appContainer = doc.getElementById('app-container')!;
const addItemForm = doc.getElementById('add-item-form') as HTMLFormElement;
const itemNameInput = doc.getElementById('itemName') as HTMLInputElement;
const itemQtyInput = doc.getElementById('itemQty') as HTMLInputElement;
const itemRateInput = doc.getElementById('itemRate') as HTMLInputElement;
const billItemsList = doc.getElementById('bill-items-list') as HTMLUListElement;
const subtotalEl = doc.getElementById('subtotal')!;
const grandTotalEl = doc.getElementById('grandTotal')!;
const discountInput = doc.getElementById('discount') as HTMLInputElement;
const salesHistoryBody = doc.getElementById('sales-history-body')!;
const billingView = doc.getElementById('billing-view')!;
const dashboardView = doc.getElementById('dashboard-view')!;

// Modal & Stat Elements
const previewModal = doc.getElementById('preview-modal')!;
const receiptPreviewContent = doc.getElementById('receipt-preview-content')!;
const btnPreview = doc.getElementById('btn-preview')!;
const btnClosePreview = doc.getElementById('btn-close-preview')!;
const btnCancelPreview = doc.getElementById('btn-cancel-preview')!;
const btnConfirmPrint = doc.getElementById('btn-confirm-print')!;
const statTotalRevenue = doc.getElementById('stat-total-revenue')!;
const statTotalBills = doc.getElementById('stat-total-bills')!;


// --- RECEIPT HTML GENERATION ---
// This function creates a full, self-contained HTML document for printing
function generateReceiptHtmlForPrint(receiptData: ReceiptData): string {
    const itemRows = receiptData.items.map(item => `<tr><td>${item.name}</td><td style="text-align: center;">${item.quantity}</td><td class="text-right">${item.rate.toFixed(2)}</td><td class="text-right">${(item.quantity * item.rate).toFixed(2)}</td></tr>`).join('');
    // BUG FIX: Always create a new Date object from the timestamp's seconds property
    const receiptDate = new Date(receiptData.receiptDate.seconds * 1000);

    return `<!DOCTYPE html><html><head><title>Receipt ${receiptData.receiptNumber}</title><style>body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; margin: 0; } .receipt { width: 300px; margin: 0 auto; } .receipt-header { text-align: center; margin-bottom: 10px; } .receipt-header h1 { margin: 0; font-size: 18px; font-weight: bold; } .receipt-header h2 { margin: 0; font-size: 14px; font-weight: normal; } .receipt-details { padding: 5px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; } .receipt-details p { margin: 3px 0; display: flex; justify-content: space-between; } table { width: 100%; border-collapse: collapse; margin-top: 5px; } th, td { padding: 3px 0; } thead th { border-bottom: 1px dashed #000; text-align: left; } .text-right { text-align: right; } .receipt-summary { margin-top: 10px; border-top: 1px dashed #000; padding-top: 5px; } .summary-row { display: flex; justify-content: space-between; margin: 3px 0; } .summary-row.total { font-weight: bold; font-size: 14px; border-top: 1px solid #000; padding-top: 5px; margin-top: 5px; } .receipt-footer { text-align: center; margin-top: 15px; } </style></head><body> <div class="receipt"> <div class="receipt-header"><h1>Arab Times</h1><h2>Cash Receipt</h2></div> <div class="receipt-details"><p><span>Receipt No:</span> <span>${receiptData.receiptNumber}</span></p><p><span>Date:</span> <span>${receiptDate.toLocaleString()}</span></p></div> <table><thead><tr><th>Item</th><th style="text-align: center;">Qty</th><th class="text-right">Rate</th><th class="text-right">Total</th></tr></thead><tbody>${itemRows}</tbody></table> <div class="receipt-summary"><div class="summary-row"><span>Subtotal:</span> <span>${receiptData.subtotal.toFixed(2)}</span></div><div class="summary-row"><span>Discount:</span> <span>-${receiptData.discount.toFixed(2)}</span></div><div class="summary-row total"><span>Grand Total:</span> <span>${formatCurrency(receiptData.grandTotal)}</span></div><div class="summary-row"><span>Payment Mode:</span> <span>${receiptData.paymentMode}</span></div></div> <div class="receipt-footer"><p>Thank you for shopping with us!</p></div> </div> </body></html>`;
}
// This function creates just the inner HTML for the on-screen preview
function generateReceiptHtmlForPreview(receiptData: ReceiptData): string {
    const fullHtml = generateReceiptHtmlForPrint(receiptData);
    // Extracts only the part inside the <body> tag for the modal
    return fullHtml.split('<body>')[1].split('</body>')[0];
}


// --- MODAL & PREVIEW LOGIC ---
function openPreviewModal(isViewOnly = false) { 
    btnConfirmPrint.style.display = isViewOnly ? 'none' : 'inline-flex';
    previewModal.classList.remove('hidden'); 
}
function closePreviewModal() { 
    previewModal.classList.add('hidden'); 
    pendingReceipt = null; 
}


// --- MAIN APP RENDER FUNCTIONS ---
function renderBillItems() {
    billItemsList.innerHTML = billItems.length === 0 ? `<li class="text-center p-4 text-slate-500">No items added yet.</li>` : billItems.map((item) => `<li class="flex items-center p-2 space-x-4"><div class="flex-1"><p class="font-medium">${item.name}</p><p class="text-sm text-slate-500">${item.quantity} x ${formatCurrency(item.rate)}</p></div><div class="font-semibold">${formatCurrency(item.quantity * item.rate)}</div><button class="text-red-500 hover:text-red-700 p-1" data-id="${item.id}">Remove</button></li>`).join('');
}
function updateSummary() {
    const subtotal = billItems.reduce((acc, item) => acc + item.quantity * item.rate, 0);
    const discount = Number(discountInput.value) || 0;
    const grandTotal = subtotal - discount;
    subtotalEl.textContent = formatCurrency(subtotal);
    grandTotalEl.textContent = formatCurrency(grandTotal);
    btnPreview.disabled = billItems.length === 0;
}
function resetBill() {
    billItems = [];
    addItemForm.reset();
    discountInput.value = '';
    renderBillItems();
    updateSummary();
    itemNameInput.focus();
}

async function showDashboard() {
    billingView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    doc.getElementById('btn-view-billing')!.classList.remove('active');
    doc.getElementById('btn-view-dashboard')!.classList.add('active');
    salesHistoryBody.innerHTML = '<tr><td colspan="5" class="text-center p-4">Loading...</td></tr>';
    
    try {
        const q = query(collection(db, "receipts"), orderBy("receiptDate", "desc"));
        const querySnapshot = await getDocs(q);
        allReceipts = querySnapshot.docs.map(doc => doc.data() as ReceiptData);

        const totalRevenue = allReceipts.reduce((sum, receipt) => sum + receipt.grandTotal, 0);
        statTotalRevenue.textContent = formatCurrency(totalRevenue);
        statTotalBills.textContent = allReceipts.length.toString();

        salesHistoryBody.innerHTML = allReceipts.length === 0 ? '<tr><td colspan="5" class="text-center p-4">No sales records found.</td></tr>' : '';
        allReceipts.forEach(r => {
            // BUG FIX: Correctly handle date conversion here too
            const receiptDate = new Date(r.receiptDate.seconds * 1000);
            salesHistoryBody.innerHTML += `<tr><td><a href="#" class="receipt-link" data-receipt-id="${r.receiptNumber}">${r.receiptNumber}</a></td><td>${receiptDate.toLocaleDateString()}</td><td>${r.items.length}</td><td>${r.paymentMode}</td><td class="text-right font-medium">${formatCurrency(r.grandTotal)}</td></tr>`;
        });
    } catch (e) { salesHistoryBody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-red-500">Error loading data.</td></tr>`; }
}

function showBilling() {
    dashboardView.classList.add('hidden');
    billingView.classList.remove('hidden');
    doc.getElementById('btn-view-dashboard')!.classList.remove('active');
    doc.getElementById('btn-view-billing')!.classList.add('active');
}

// --- INITIALIZE THE BILLING APP ---
function initializeBillingApp() {
    appContainer.classList.remove('hidden');
    appContainer.classList.add('flex'); // Make it visible
    loginContainer.classList.add('hidden');

    // Attach all event listeners for the main app
    addItemForm.addEventListener('submit', e => { e.preventDefault(); billItems.push({ id: `item_`+Date.now(), name: itemNameInput.value, quantity: +itemQtyInput.value, rate: +itemRateInput.value }); renderBillItems(); updateSummary(); itemNameInput.value = ''; itemRateInput.value = ''; itemQtyInput.value = '1'; itemNameInput.focus(); });
    billItemsList.addEventListener('click', e => { const target = e.target as HTMLElement; if (target.matches('button[data-id]')) { billItems = billItems.filter(item => item.id !== target.dataset.id); renderBillItems(); updateSummary(); } });
    discountInput.addEventListener('input', updateSummary);

    btnPreview.addEventListener('click', () => {
        const subtotal = billItems.reduce((acc, item) => acc + item.quantity * item.rate, 0);
        const discount = Number(discountInput.value) || 0;
        pendingReceipt = { receiptNumber: generateReceiptNumber(), receiptDate: Timestamp.now(), items: billItems.map(({ id, ...rest }) => rest), discount, paymentMode: (doc.getElementById('paymentMode') as HTMLSelectElement).value as PaymentMode, subtotal, grandTotal: subtotal - discount, };
        receiptPreviewContent.innerHTML = generateReceiptHtmlForPreview(pendingReceipt);
        openPreviewModal(false); 
    });

    btnConfirmPrint.addEventListener('click', async () => {
        if (!pendingReceipt) return;
        try {
            await addDoc(collection(db, "receipts"), pendingReceipt);
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            const receiptHtml = generateReceiptHtmlForPrint(pendingReceipt);
            iframe.contentDocument!.write(receiptHtml);
            iframe.contentDocument!.close();
            iframe.contentWindow!.print();
            setTimeout(() => { document.body.removeChild(iframe); }, 100);
            closePreviewModal();
            resetBill();
        } catch (error) { alert('Failed to save receipt.'); console.error("Error saving receipt: ", error); }
    });

    salesHistoryBody.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('receipt-link')) {
            e.preventDefault();
            const receiptId = target.dataset.receiptId;
            const historicReceipt = allReceipts.find(r => r.receiptNumber === receiptId);
            if (historicReceipt) {
                receiptPreviewContent.innerHTML = generateReceiptHtmlForPreview(historicReceipt);
                openPreviewModal(true); 
            }
        }
    });

    btnClosePreview.addEventListener('click', closePreviewModal);
    btnCancelPreview.addEventListener('click', closePreviewModal);
    doc.getElementById('btn-view-billing')!.addEventListener('click', showBilling);
    doc.getElementById('btn-view-dashboard')!.addEventListener('click', showDashboard);

    // Initial render
    showBilling();
    renderBillItems();
    updateSummary();
}


// --- APPLICATION STARTUP LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already logged in (e.g., reloaded the page)
    if (sessionStorage.getItem('isLoggedIn') === 'true') {
        initializeBillingApp();
    }

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const usernameInput = (doc.getElementById('username') as HTMLInputElement).value;
        const passwordInput = (doc.getElementById('password') as HTMLInputElement).value;

        // --- WARNING: This is NOT secure. For demonstration purposes only. ---
        if (usernameInput === 'User97' && passwordInput === '#Arab_Times@1962') {
            sessionStorage.setItem('isLoggedIn', 'true');
            initializeBillingApp();
        } else {
            loginError.classList.remove('hidden');
            (doc.getElementById('password') as HTMLInputElement).value = ''; // Clear password field
        }
    });
});