const CHUNK = 10 * 320 * 1024;
export const LIMITE = 250 * 1024 * 1024;
const read = file => new Promise((resolve,reject)=>{
  const r=new FileReader();
  r.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));
  r.onload=()=>resolve(String(r.result).split(',')[1]);
  r.readAsDataURL(file);
});

export async function enviaAnexo(api, meta, file, status, progresso) {
  const ativo=(status || await api('onedrive/status',{silencioso:true})).conectado;
  const body={...meta,nome:file.name,mime:file.type};
  const post=(path,body)=>api(path,{method:'POST',body,silencioso:true});
  if(!ativo){
    if(file.size>4e6)throw new Error('Arquivo acima de 4 MB. Para enviá-lo, conecte o OneDrive.');
    return post('documento',{...body,b64:await read(file)});
  }
  if(file.size<1 || file.size>LIMITE)throw new Error('Selecione um arquivo de até 250 MB.');
  const sessao=await post('onedrive/enviar',{...body,tamanho:file.size});
  let id;
  for(let inicio=0;inicio<file.size;){
    const fim=Math.min(inicio+CHUNK,file.size);
    const r=await fetch(sessao.url,{method:'PUT',credentials:'omit',
      headers:{'Content-Range':'bytes '+inicio+'-'+(fim-1)+'/'+file.size},
      body:file.slice(inicio,fim),signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw new Error('O OneDrive interrompeu o envio ('+r.status+').');
    const d=await r.json();
    if(r.status===202) {
      const proximo=Number(/^(\d+)-/.exec(d.nextExpectedRanges?.[0]||'')?.[1]);
      if(proximo!==fim)throw new Error('O OneDrive não confirmou a parte enviada. Tente novamente.');
    } else id=d.id;
    inicio=fim;
    progresso?.(Math.round(fim/file.size*100));
  }
  if(!id)throw new Error('O OneDrive não confirmou a gravação.');
  return post('documento',{...body,onedrive:{ticket:sessao.ticket,id}});
}

export async function telaOneDrive({root,api,admin}) {
  const node=(tag,label)=>{const e=document.createElement(tag);if(label)e.textContent=label;return e;};
  const btn=(label,acao)=>{const e=node('button',label);e.type='button';e.onclick=acao;return e;};
  const status=await api('onedrive/status');
  const card=node('div');card.className='card';
  card.append(node('h3','Documentos no OneDrive'));
  const controls=node('div');controls.className='bt';
  controls.append(btn('← Documentos',()=>location.hash='documentos'));
  card.append(controls);
  const conteudo=node('div');
  card.append(conteudo);
  root.replaceChildren(card);
  const abrirConfig = () => {
    const form=node('form');
    const msg=node('p');
    msg.setAttribute('role','status');
    form.append(node('p','Use o aplicativo da Carteira registrado no Microsoft Entra. Cadastre este endereço de retorno em Plataforma Web: '+location.origin+'/api/onedrive/retorno'));
    const campo=(texto,tipo)=>{const label=node('label',texto),i=node('input');i.type=tipo;i.required=true;i.autocomplete='off';label.append(i);form.append(label);return i;};
    const client=campo('ID do aplicativo','text');
    const secret=campo('Valor do segredo do aplicativo','password');
    const b=node('button','Autorizar na Microsoft');b.type='submit';b.className='pri';form.append(b,msg);
    form.onsubmit=async e=>{
      e.preventDefault();b.disabled=true;
      try{
        const r=await api('onedrive/conectar',{method:'POST',body:{client:client.value,secret:secret.value},silencioso:true});
        secret.value='';
        location.assign(r.url);
      }catch(e){msg.textContent=e.message;b.disabled=false;}
    };
    conteudo.replaceChildren(form);
  };
  if(admin && status.configuravel)controls.append(btn(status.conectado?'Reconectar OneDrive':'Conectar OneDrive',abrirConfig));
  if(!status.conectado){
    conteudo.append(node('p',status.configuravel?'O administrador precisa conectar a conta Microsoft que contém a pasta Beira Rio ADM → Documentos.':'A ativação do OneDrive está pendente.'));
    return;
  }
  let itens=[], carregar;
  const trilha=node('div');trilha.className='bt';
  const pesquisa=node('form');pesquisa.className='bt';
  const consulta=node('input');consulta.placeholder='Pesquisar no acervo';consulta.setAttribute('aria-label','Pesquisar no acervo');consulta.required=true;
  const pesquisar=node('button','Pesquisar');pesquisar.className='pri';pesquisar.type='submit';pesquisa.append(consulta,pesquisar);
  const busca=node('input');busca.placeholder='Filtrar esta pasta';busca.setAttribute('aria-label','Filtrar esta pasta');
  const tabela=node('table'), footer=node('div'), aviso=node('p');
  aviso.setAttribute('role','status');
  conteudo.append(pesquisa,trilha,busca,aviso,tabela,footer);
  const desenha=()=>{
    const filtro=busca.value.trim().toLocaleLowerCase('pt-BR');
    tabela.replaceChildren(...itens.filter(x=>String(x.nome).toLocaleLowerCase('pt-BR').includes(filtro)).map(x=>{
      const tr=node('tr'),td=node('td');
      const b=btn(x.pasta?'📁 '+x.nome:x.nome,async()=>{
        if(x.pasta){await carregar(x.cursor);return;}
        const nova=window.open('about:blank','_blank');
        if(!nova){aviso.textContent='Libere a abertura de janelas neste site.';return;}
        nova.opener=null;
        try {const {url}=await api('onedrive/abrir?cursor='+encodeURIComponent(x.cursor),{silencioso:true});nova.location.replace(url);}
        catch(e){nova.close();aviso.textContent=e.message;}
      });
      td.append(b);if(x.pai)td.append(node('small',' '+x.pai));tr.append(td);return tr;
    }));
  };
  busca.oninput=desenha;
  let ordem=0;
  carregar=async(cursor,mais=false,termo='')=>{
    const seq=++ordem;
    aviso.textContent='Carregando…';footer.replaceChildren();
    try{
      const query=cursor?'?cursor='+encodeURIComponent(cursor):termo?'?busca='+encodeURIComponent(termo):'';
      const r=await api('onedrive/listar'+query,{silencioso:true});
      if(seq!==ordem)return;
      if(!mais){itens=[];busca.value='';}
      itens.push(...r.itens);
      trilha.replaceChildren(...r.trilha.map(x=>btn(x.nome,()=>carregar(x.cursor))));
      desenha();
      aviso.textContent=itens.length?'':termo?'Nenhum arquivo encontrado.':'Pasta vazia.';
      if(r.proximo)footer.append(btn('Carregar mais',()=>carregar(r.proximo,true)));
    }catch(e){if(seq===ordem)aviso.textContent=e.message;}
  };
  pesquisa.onsubmit=e=>{e.preventDefault();carregar(null,false,consulta.value.trim());};
  await carregar();
}
