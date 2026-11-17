// Read-only local fixture. No production API, account, or real orders are used.
(function () {
  const day = (offset, hour = '12:00') => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    return `${key}T${hour}:00`;
  };
  const profile = { id: 'preview-driver', name: 'Driver Preview', phone: '08000000000' };
  const base = { customer_order_type:'DELIVERY', payment_provider:'courier_cash', payment_status:'Lunas',
    subtotal:25000, delivery_fee:14000, grand_total:39000, delivery_distance_meters:5631,
    driver_id:profile.id, delivery_note:'Teras depan, pagar hijau', delivery_latitude:5.3536838, delivery_longitude:95.9250859,
    created_at:day(0,'09:10'), items:[{id:'preview-item',product_name:'Kopi susu',qty:1,price:25000}] };
  const ready = { ...base, id:'preview-ready', order_number:'D101', customer_name:'Pelanggan Preview',
    customer_order_status:'READY_FOR_PICKUP', status:'Siap Diambil', confirmed_at:day(0,'09:15'),
    driver_accepted_at:day(0,'09:12'), ready_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  const completed = (id,number,name,offset,hour,fee) => ({ ...base,id,order_number:number,customer_name:name,
    customer_order_status:'COMPLETED',status:'Selesai',delivery_fee:fee,grand_total:25000+fee,
    completed_at:day(offset,hour),updated_at:day(offset,hour) });
  const rows = [ready,
    completed('preview-today-1','D100','Pelanggan A',0,'10:40',14000),
    completed('preview-today-2','D099','Pelanggan B',0,'08:25',15500),
    completed('preview-yesterday','D098','Pelanggan C',-1,'14:10',25000),
    completed('preview-earlier','D096','Pelanggan D',-3,'11:35',17500),
    completed('preview-previous','D090','Pelanggan E',-10,'15:20',14000)];
  const query = table => {
    const q = {};
    for (const method of ['select','eq','in','order','limit']) q[method] = () => q;
    q.then = resolve => Promise.resolve(resolve({data:table==='order_items' ? base.items : [],error:null}));
    q.update = () => { throw Error('Aksi transaksi tidak tersedia di pratinjau lokal.'); };
    return q;
  };
  window.DriverAppConfig={storeLatitude:5.3722219,storeLongitude:95.9585189};
  window.DriverUtils={shortDateTime:value=>new Date(value).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})};
  window.DriverSupabase={ready:async()=>({from:query,rpc:async(name,params)=>{
    if(name!=='driver_order_feed') return {data:null,error:{message:'Aksi transaksi tidak tersedia di pratinjau lokal.'}};
    await new Promise(resolve=>setTimeout(resolve,120));
    return {data:rows.filter(order=>order.customer_order_status!=='COMPLETED'||
      (new Date(order.completed_at)>=new Date(params.p_from)&&new Date(order.completed_at)<new Date(params.p_to))),error:null};
  }})};
  window.startAnterinPreview=()=>{
    DriverNotifications.configure({sound:false,readySound:false,vibration:false,readyVibration:false,repeat:false});
    DriverNotifications.deviceCredentials=()=>({id:'preview-device',secret:'local-fixture'});
    Object.assign(DriverOrder.state,{profile,view:'active',orders:rows,error:'',selectedId:'',fetching:false,loading:false});
    localStorage.removeItem('anterin_ready_alerted_preview-driver');
    DriverNotifications.update([],profile,[ready]);
    DriverOrder.renderUI();
  };
}());
