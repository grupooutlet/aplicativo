// Transcription of the store's delivery tables, with owner corrections on 24/10/2026.
// IDs are assigned at import time. Existing orders keep their frozen freight values.
const rows=[];
function add(city,price,localities='',extra={}){
  const neighborhoods=localities?localities.split('|'):[];
  rows.push({name:extra.name||neighborhoods.join(' / ')||city,price,delivery:'Entrega',active:true,
    region:{state:'RJ',city,neighborhoods},...extra});
}
function list(city,price,names){for(const name of names.split(';'))add(city,price,name);}
list('Nova Iguaçu',150,'Santa Rita|Vila Iguaçu|Rancho Fundo;Vila de Cava|Figueira|Geneciano;Conjunto Marinha|Ipiranga;Marapicu|Jardim Paraíso;Lagoinha|Jardim Guandu|Prados Verdes;KM 32|Dom Bosco');
list('Nova Iguaçu',100,'Cerâmica|Ponto Chic|Cobrex;Posse|Carmari|Nova América;Caioaba|Caioba|Viga|Vila Operária;Jardim Alvorada;Jardim Pernambuco;Ouro Verde;Jardim Nova Era;Jardim Palmares;Comendador Soares|Morro Agudo;Rosa dos Ventos|Rodilândia;Riachão|Cacuia');
list('Nova Iguaçu',130,'Botafogo|Parque Flora|Ambaí;Miguel Couto|Shangri-lá;Palhada|Valverde;Austin|Vila Guimarães|Inconfidência');
add('Nova Iguaçu',130,'Cabuçu',{note:'Entrega em Cabuçu somente até a UPA.',confirmationRequired:true});
add('Belford Roxo',130,'Nova Aurora');
add('Seropédica',150,'Campo Lindo');add('Seropédica',170);
for(const [city,price] of Object.entries({'Queimados':150,'Japeri':170,'Paracambi':250,'Engenheiro Paulo de Frontin':250,'Mendes':270,'Barra do Piraí':400,'Vassouras':450,'Miguel Pereira':350,'Volta Redonda':450,'Barra Mansa':450,'Mesquita':100,'Nilópolis':130,'São João de Meriti':130}))add(city,price);
add('Japeri',180,'Engenheiro Pedreira');add('São João de Meriti',150,'Vilar dos Teles');
list('Rio de Janeiro',150,'Anchieta;Ricardo de Albuquerque;Pavuna');
list('Rio de Janeiro',170,'Costa Barros|Barros Filho;Coelho Neto|Irajá;Deodoro|Marechal Hermes;Honório Gurgel|Rocha Miranda;Bento Ribeiro;Oswaldo Cruz;Tomás Coelho;Madureira|Cascadura;Quintino|Quintino Bocaiúva|Piedade;Pilares;Del Castilho;Engenho de Dentro;Méier;Engenho Novo;Vigário Geral;Parada de Lucas;Cordovil;Brás de Pina;Penha;Olaria;Ramos;Bonsucesso;Manguinhos;Jacaré;Triagem;Riachuelo;São Francisco Xavier;Caju;Maré;Realengo;Magalhães Bastos;Vila Militar;Jardim Sulacap;Vila Valqueire;Campinho');
list('Rio de Janeiro',180,'Maracanã;São Cristóvão');
list('Belford Roxo',150,'Piam;Parque São Vicente;Bom Pastor;Redentor');
list('Belford Roxo',170,'Parque Roseiral;Pnona;São José|Parque São José');
list('Belford Roxo',130,'Centro;Heliópolis');
list('Rio de Janeiro',180,'Muzema;Leblon;Jardim Botânico;Ipanema;Urca;Botafogo;Flamengo;Cosme Velho;Glória;Santa Teresa|Santa Tereza;Lapa;Estácio;Rio Comprido;Tijuca;Andaraí;Grajaú;Vila Isabel;Usina;Ilha do Governador');
list('Rio de Janeiro',200,'Itanhangá;São Conrado;Rocinha');
list('Duque de Caxias',170,'Centro;Vila Operária;Parque Beira Mar;Vila São Luiz|Vila São Luís;Vila Centenário;Parque Araruama;Jardim Sumaré;Jardim Metrópoles;Vila Leopoldina');
list('Duque de Caxias',180,'Jardim Leal;Pantanal;Parque Fluminense');add('Belford Roxo',180,'Lote XV|Lote Quinze');
list('Duque de Caxias',200,'Pilar;Campos Elíseos;Jardim Primavera;Saracuruna');
list('Duque de Caxias',250,'Parque Paulista;Parada Angélica');
add('Magé',250);add('Magé',250,'Piabetá');add('Guapimirim',250);
list('Rio de Janeiro',170,'Bangu|Senador Camará;Santíssimo;Senador Vasconcelos;Campo Grande;Cosmos;Inhoaíba;Paciência;Praça Seca');
list('Rio de Janeiro',180,'Santa Cruz;Guaratiba;Rio das Pedras;Tanque;Taquara;Pechincha;Freguesia|Freguesia (Jacarepaguá)|Freguesia de Jacarepaguá|Jacarepaguá;Anil;Cidade de Deus;Curicica;Camorim');
list('Rio de Janeiro',200,'Sepetiba;Pedra de Guaratiba;Vargem Pequena;Vargem Grande|Vagem Grande;Recreio|Recreio dos Bandeirantes;Barra da Tijuca');
for(const [city,price] of Object.entries({'Itaguaí':200,'Mangaratiba':350,'Angra dos Reis':450,'Paraty':550,'Resende':500,'Petrópolis':450,'Teresópolis':450,'Areal':550,'Três Rios':600,'São Gonçalo':250,'Niterói':200,'Maricá':400,'Saquarema':550,'Araruama':600,'São Pedro da Aldeia':650,'Cabo Frio':650,'Arraial do Cabo':650,'Armação dos Búzios':650,'Rio das Ostras':750,'Casimiro de Abreu':650,'Macaé':850,'Rio Bonito':500,'Tanguá':400,'Itaboraí':300}))add(city,price);
list('Duque de Caxias',300,'Xerém;Parque Capivari');
add('Petrópolis',500,'Itaipava');add('Petrópolis',550,'Posse');
add('Niterói',250,'Camboinhas|Piratininga');
add('Maricá',250,'Itaipuaçu');add('Maricá',300,'Inoã');add('Maricá',500,'Ponta Negra');
add('Cabo Frio',650,'Unamar');add('Itaboraí',300,'Manilha');
rows.find(r=>r.name==='Mesquita').name='Mesquita / Cosmorama';
// Ilha do Governador is an area, while postal addresses use its individual bairros.
// Municipality reference: https://www.rio.rj.gov.br/web/guest/exibeconteudo?id=4360872
rows.find(r=>r.name==='Ilha do Governador').region.neighborhoods.push('Bancários','Cacuia','Cocotá','Freguesia (Ilha do Governador)','Galeão','Jardim Carioca','Jardim Guanabara','Moneró','Pitangueiras','Portuguesa','Praia da Bandeira','Ribeira','Tauá','Zumbi');
// Postal neighborhoods inside the Itaipuaçu area, using municipal district/health records.
// https://www.marica.rj.gov.br/relacao-dos-postos-de-saude/
// https://marica.rj.gov.br/wp-content/uploads/2022/06/ENDEREC%CC%A7O-CRAS.pdf
rows.find(r=>r.name==='Itaipuaçu').region.neighborhoods.push('Recanto de Itaipuaçu','Recanto','Praia de Itaipuaçu','Morada das Águias','Rincão Mimoso','Jardim Atlântico','Jardim Atlântico Oeste','Jardim Atlântico Central','Jardim Atlântico Leste','Barroco','São Bento da Lagoa','Itaocaia Valley','Itaocaia Valey','Reserva Verde');
module.exports=rows;
if(require.main===module)process.stdout.write(JSON.stringify(rows,null,2)+'\n');
