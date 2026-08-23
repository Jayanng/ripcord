import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
export function QrCode({value}:{value:string}){const[src,setSrc]=useState('');useEffect(()=>{let active=true;void QRCode.toDataURL(value,{width:320,margin:2,color:{dark:'#111111',light:'#eeeeee'}}).then(url=>{if(active)setSrc(url)});return()=>{active=false}},[value]);return src?<img className="qr-code" src={src} width="220" height="220" alt="QR code for the displayed receive address"/>:<div className="qr-loading" aria-live="polite">Generating QR…</div>}
