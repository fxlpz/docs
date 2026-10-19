import { createHash } from 'node:crypto';
import type { Db } from '../db/database.js';
import { newId } from '../lib/ids.js';
import { logActivity } from './activity.js';
import { blocksToPlainText } from './nodes.js';

/**
 * Modelos padrão do workspace, no formato de página do Notion:
 * ícone na página, callout de instrução, seções com emoji, divisores,
 * tabelas prontas para preencher e toggles para o conteúdo opcional.
 *
 * Regras:
 * - Conteúdo real e editável: são páginas comuns, marcadas como modelo.
 * - Criação UMA vez, marcada em `settings.default_templates_seeded`
 *   (`{version, hashes, seen}`; nas versões 1–2 valia `'1'`).
 * - Quem apaga um modelo não faz ele voltar (só o botão "Restaurar modelos
 *   padrão"). Modelos NOVOS adicionados em versões futuras entram sozinhos
 *   (por isso o `seen`: os nomes já conhecidos não são recriados).
 * - Quando o conteúdo aqui muda, a próxima subida de
 *   `DEFAULT_TEMPLATES_VERSION` regrava as páginas **que ninguém editou**
 *   (hash da última gravação do seed bate com o conteúdo corrente); páginas
 *   tocadas pela equipe são preservadas e a versão antiga fica no histórico.
 */

export const DEFAULT_TEMPLATES_SEEDED_KEY = 'default_templates_seeded';
/** Bumpar ao alterar o conteúdo de qualquer modelo padrão. */
export const DEFAULT_TEMPLATES_VERSION = 3;
const FOLDER_TITLE = 'Modelos padrão';

/** Modelos que já existiam nas versões 1–2 do seed (nunca são recriados). */
const LEGACY_TEMPLATE_NAMES = [
  'Runbook de incidente de segurança',
  'Checklist de virada de plantão',
  'Relatório de vulnerabilidade',
  'Checklist de hardening de servidor',
  'Procedimento de mudança em produção',
  'Ata de reunião',
];

/* -------------------------------------------------------------------------- */
/* Tipos e utilitários de conteúdo (formato serializado do BlockNote)          */
/* -------------------------------------------------------------------------- */

type StyleName = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

interface InlineText {
  type: 'text';
  text: string;
  styles?: Record<StyleName, true>;
}

type Inline = string | InlineText;

interface TableCell {
  type: 'tableCell';
  content: string | InlineText[];
}

interface TableContent {
  type: 'tableContent';
  headerRows: number;
  rows: Array<{ cells: TableCell[] }>;
}

type BlockType =
  | 'paragraph'
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'checkListItem'
  | 'quote'
  | 'toggleListItem'
  | 'divider'
  | 'table';

interface ContentBlock {
  type: BlockType;
  content?: string | InlineText[] | TableContent;
  props?: { level?: 1 | 2 | 3; backgroundColor?: string };
  children?: ContentBlock[];
}

interface DefaultTemplate {
  /** Nome exibido na lista de modelos (e título da página). */
  name: string;
  /** Emoji da página (padrão Notion). */
  icon: string;
  category: string;
  description: string;
  blocks: ContentBlock[];
}

const txt = (text: string, styles?: StyleName[]): InlineText =>
  styles && styles.length > 0
    ? {
        type: 'text',
        text,
        styles: Object.fromEntries(styles.map((style) => [style, true])) as Record<StyleName, true>,
      }
    : { type: 'text', text };

/** Normaliza para o formato aceito pelo BlockNote: string ou texto[] (nunca misto). */
function toContent(inlines: Inline[]): string | InlineText[] {
  const first = inlines[0];
  if (inlines.length === 1 && typeof first === 'string') return first;
  return inlines.map((inline) => (typeof inline === 'string' ? txt(inline) : inline));
}

const bold = (text: string): InlineText => txt(text, ['bold']);
const code = (text: string): InlineText => txt(text, ['code']);

const para = (...inlines: Inline[]): ContentBlock => ({
  type: 'paragraph',
  content: toContent(inlines),
});
const h = (level: 1 | 2 | 3, text: string): ContentBlock => ({
  type: 'heading',
  props: { level },
  content: text,
});
/** Título de seção com emoji (padrão Notion). */
const section = (emoji: string, title: string): ContentBlock => h(1, `${emoji} ${title}`);
const sub = (text: string): ContentBlock => h(2, text);
const bullet = (...inlines: Inline[]): ContentBlock => ({
  type: 'bulletListItem',
  content: toContent(inlines),
});
const step = (...inlines: Inline[]): ContentBlock => ({
  type: 'numberedListItem',
  content: toContent(inlines),
});
const check = (...inlines: Inline[]): ContentBlock => ({
  type: 'checkListItem',
  content: toContent(inlines),
});
/** Campo de preenchimento: rótulo em negrito + dica em texto normal. */
const field = (label: string, hint = ''): ContentBlock =>
  hint ? bullet(txt(`${label}: `, ['bold']), hint) : bullet(txt(`${label}: `, ['bold']));
/** Callout com fundo colorido (Notion): instrução (cinza) ou alerta (amarelo). */
const callout = (emoji: string, text: string, color = 'gray'): ContentBlock => ({
  type: 'paragraph',
  props: { backgroundColor: color },
  content: toContent([txt(`${emoji} `, ['bold']), txt(text)]),
});
const quote = (...inlines: Inline[]): ContentBlock => ({
  type: 'quote',
  content: toContent(inlines),
});
const divider = (): ContentBlock => ({ type: 'divider' });
/** Seção recolhível (toggle do Notion) para conteúdo opcional/referência. */
const toggle = (title: string, children: ContentBlock[]): ContentBlock => ({
  type: 'toggleListItem',
  content: title,
  children,
});
/** Tabela com cabeçalho. `rows` com células de texto simples. */
const table = (headers: string[], rows: string[][]): ContentBlock => ({
  type: 'table',
  content: {
    type: 'tableContent',
    headerRows: 1,
    rows: [
      { cells: headers.map((text) => ({ type: 'tableCell' as const, content: text })) },
      ...rows.map((row) => ({
        cells: row.map((text) => ({ type: 'tableCell' as const, content: text })),
      })),
    ],
  },
});

/** Rodapé de controle do documento (tabela de versões). */
const changelog = (): ContentBlock[] => [
  divider(),
  section('📆', 'Controle do documento'),
  table(['Versão', 'Data', 'Autor', 'Alteração'], [['1.0', '', '', '']]),
];

/* -------------------------------------------------------------------------- */
/* Modelos padrão                                                              */
/* -------------------------------------------------------------------------- */

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: 'Runbook de incidente de segurança',
    icon: '🚨',
    category: 'Operações',
    description:
      'Resposta em fases com critérios de saída, linha do tempo e métricas — base no ciclo NIST SP 800-61.',
    blocks: [
      callout(
        '💡',
        'Como usar: preencha o registro logo na confirmação do alerta e mantenha a linha do tempo atualizada. Avance de fase só quando o critério de saída estiver atendido e registrado.',
      ),
      section('📋', '1. Registro do incidente'),
      field('ID do incidente', 'INC-AAAA-NNN'),
      field('Data e hora da detecção', 'DD/MM/AAAA HH:MM (fuso de Brasília)'),
      field('Origem do alerta', 'monitoramento, usuário, fornecedor, varredura'),
      field('Comandante do incidente'),
      field('Equipe acionada'),
      field('Severidade inicial', 'Crítica / Alta / Média / Baixa'),
      field('Ativos, aplicações e dados afetados'),
      section('⚖️', '2. Classificação e impacto'),
      bullet(bold('Confidencialidade: '), 'dado exposto? qual tipo, volume e titularidade?'),
      bullet(bold('Integridade: '), 'dado alterado? como comprovar a restauração?'),
      bullet(bold('Disponibilidade: '), 'serviço indisponível por quanto tempo?'),
      bullet(bold('Impacto ao negócio: '), 'clientes afetados, SLA, receita e prazos legais'),
      check(
        'Notificação de dados pessoais avaliada com o encarregado (DPO) — registrar decisão, prazo e fundamento (LGPD, quando aplicável).',
      ),
      divider(),
      section('🛡️', '3. Contenção'),
      sub('Curto prazo (minutos a horas)'),
      step('Preservar evidências: image/snapshot do ativo e cópia dos logs antes de alterar nada.'),
      step('Isolar o ativo ou o segmento afetado sem interromper a coleta de evidências.'),
      step('Bloquear contas, tokens, IPs ou mecanismo de acesso comprometido.'),
      step('Encerrar sessões ativas e revogar credenciais expostas.'),
      sub('Longo prazo (horas)'),
      step('Reduzir a superfície: desligar serviço não essencial ou restringir a rede de gestão.'),
      step('Manter o serviço crítico com controles compensatórios documentados.'),
      step('Definir e registrar a data/hora prevista de término da contenção.'),
      quote(
        bold('Critério de saída: '),
        'vetor de entrada bloqueado, sem indícios novos de comprometimento nas últimas 4 horas e evidências preservadas.',
      ),
      section('🧹', '4. Erradicação'),
      step('Confirmar a causa raiz e o vetor de entrada.'),
      step('Remover a presença maliciosa (arquivos, contas, cron, chaves, extensões).'),
      step('Corrigir a vulnerabilidade explorada (patch, configuração ou regra).'),
      step('Rotacionar todas as credenciais, chaves e certificados expostos.'),
      step('Validar com varredura do EDR/antivírus e revisão de integridade.'),
      quote(
        bold('Critério de saída: '),
        'nenhuma presença ativa confirmada e correção aplicada e testada.',
      ),
      section('🔁', '5. Recuperação'),
      step('Restaurar dados apenas de backup confiável, anterior ao comprometimento.'),
      step('Reconstruir o ativo quando a erradicação não puder ser garantida.'),
      step('Validar funcionamento com testes de fumaça junto à área dona do serviço.'),
      step('Monitorar indicadores suspeitos por 72 horas antes de encerrar o incidente.'),
      section('🕒', '6. Linha do tempo'),
      para(txt('Uma linha por evento: data, hora, quem agiu e o que foi decidido.', ['italic'])),
      table(
        ['Data e hora', 'Responsável', 'O que aconteceu / decisão'],
        [
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ],
      ),
      section('📊', '7. Pós-incidente e métricas'),
      check('Post-mortem sem culpa realizado em até 5 dias úteis.'),
      check('Causa raiz documentada e evidências anexadas.'),
      check('Ações preventivas com responsável, prazo e prioridade.'),
      check('Runbooks, monitoramento e treinamento atualizados.'),
      check('Comunicação final enviada às partes interessadas.'),
      table(
        ['Métrica', 'Resultado'],
        [
          ['MTTD — tempo até a detecção', ''],
          ['MTTC — tempo até a contenção', ''],
          ['MTTR — tempo até a recuperação', ''],
          ['Data do post-mortem', ''],
        ],
      ),
      toggle('📚 Referências', [
        bullet('NIST SP 800-61 — guia de resposta a incidentes'),
        bullet('ISO/IEC 27035 — gestão de incidentes de segurança'),
        bullet('Política interna de segurança e classificação de ativos'),
      ]),
      ...changelog(),
    ],
  },
  {
    name: 'Checklist de virada de plantão',
    icon: '🕘',
    category: 'Operações',
    description:
      'Handover de turno: status do período, riscos em aberto, escalonamento e confirmação de recebimento.',
    blocks: [
      callout(
        '💡',
        'Como usar: conclua em até 30 minutos antes da virada. Todo item não marcado exige justificativa na tabela de riscos em aberto.',
      ),
      section('📋', 'Resumo do turno'),
      field('Período', 'DD/MM/AAAA HH:MM → DD/MM/AAAA HH:MM'),
      field('Plantonista que sai'),
      field('Plantonista que entra'),
      field('Status geral', 'Estável / Alertas ativos / Incidente em andamento'),
      field('Pendências em aberto', 'quantidade'),
      section('✅', 'Fechamento do turno'),
      check('Alertas do período revisados, cada um com status e próximo passo.'),
      check('Chamados em aberto atualizados (descrição, prioridade, próximo passo).'),
      check('Incidentes em andamento repassados com fase atual e ação imediata.'),
      check('Mudanças e implantações concluídas ou canceladas registradas.'),
      check('Jobs e manutenções agendadas verificados quanto ao resultado.'),
      section('🌅', 'Abertura do novo turno'),
      check('Alertas das últimas 12 horas revisados.'),
      check('Backups noturnos concluídos com sucesso.'),
      check('Serviços críticos respondendo (status, latência e filas).'),
      check('Disco e recursos de pico sem risco de estouro.'),
      check('Filas de aprovação e processos sem bloqueio.'),
      section('⚠️', 'Riscos e pendências em aberto'),
      table(
        ['Item', 'Impacto', 'Próximo passo', 'Responsável'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      para(
        txt(
          'Se houver incidente ativo, vincule o ID e informe a fase (contenção, erradicação ou recuperação).',
          ['italic'],
        ),
      ),
      section('📇', 'Escalonamento e contatos'),
      table(
        ['Papel', 'Nome', 'Contato'],
        [
          ['Supervisão de plantão', '', ''],
          ['Coordenação de TI / Segurança', '', ''],
          ['Fornecedor crítico (24x7)', '', ''],
          ['Canal de acionamento de incidentes', '', ''],
        ],
      ),
      section('🤝', 'Confirmação'),
      check('Handover realizado com o turno entrante.'),
      check('Turno entrante confirmou o recebimento.'),
      field('Data e hora do handover'),
      field('Confirmado por'),
    ],
  },
  {
    name: 'Relatório de vulnerabilidade',
    icon: '🛡️',
    category: 'Segurança',
    description:
      'Achado técnico completo: vetor, métricas (CVSS/EPSS/KEV), evidências, remediação, risco aceito e encerramento.',
    blocks: [
      callout(
        '💡',
        'Como usar: preencha após a validação do achado. Em evidências, registre apenas o mínimo reproduzível e sem dados sensíveis de clientes — o material completo fica no anexo restrito.',
      ),
      section('🆔', 'Identificação'),
      field('CVE', 'CVE-AAAA-NNNN ou N/A (achado interno)'),
      field('CWE', 'CWE-NNN'),
      field('Data de descoberta'),
      field('Descoberto por', 'equipe interna, cliente, fornecedor, pesquisador'),
      field('Status', 'Aberta / Em correção / Risco aceito / Fechada'),
      section('🖥️', 'Ativo afetado'),
      field('Host, serviço e versão'),
      field('Ambiente', 'Produção / Homologação / Desenvolvimento'),
      field('Exposição', 'Internet / Rede interna / Somente local'),
      field('Responsável pelo ativo'),
      section('📝', 'Descrição e vetor de exploração'),
      para(
        'Explique o que foi encontrado, as pré-condições necessárias e o passo a passo do ataque, do menor nível de acesso inicial até o impacto final.',
      ),
      section('📈', 'Métricas'),
      table(
        ['Métrica', 'Valor'],
        [
          ['CVSS v3.1 (base)', 'NN.N'],
          ['Vetor CVSS', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'],
          ['EPSS (probabilidade de exploração)', 'NN%'],
          ['Explorada na natureza (CISA KEV)', 'Sim / Não'],
          ['Severidade', 'Crítica / Alta / Média / Baixa'],
        ],
      ),
      section('📎', 'Evidências'),
      para(
        'Anexe prints, saídas de comando e trechos de log relevantes. Descreva aqui o resultado; os arquivos completos vão no anexo restrito.',
      ),
      bullet(txt('Evidência 1: ', ['bold']), 'arquivo, onde está armazenado e quem pode acessar'),
      section('💥', 'Impacto'),
      para(
        'Descreva o que um atacante obtém na prática: acesso a dados, permissão de escrita, execução de código, movimentação lateral ou indisponibilidade.',
      ),
      section('🛠️', 'Remediação'),
      field('Correção recomendada'),
      field('Workaround / controles compensatórios'),
      field('Responsável pela correção'),
      field('Janela de aplicação'),
      quote(
        bold('Prazo pela severidade: '),
        'Crítica 24 horas · Alta 7 dias · Média 30 dias · Baixa 90 dias.',
      ),
      section('✍️', 'Risco aceito (quando aplicável)'),
      field('Aprovado por'),
      field('Data da aprovação'),
      field('Justificativa de negócio'),
      field('Validade / próxima revisão'),
      section('🏁', 'Verificação e encerramento'),
      check('Correção aplicada em produção.'),
      check('Verificação (varredura ou teste) confirma a ausência da falha.'),
      check('Evidência da versão corrigida anexada ao relatório.'),
      check('Comunicação de conclusão enviada ao solicitante.'),
      ...changelog(),
    ],
  },
  {
    name: 'Checklist de hardening de servidor',
    icon: '🔒',
    category: 'Segurança',
    description:
      'Baseline Linux por domínio de controle (CIS nível 1), com desvios justificados e medição de conformidade.',
    blocks: [
      callout(
        '💡',
        'Como usar: aplique na implantação e revalide a cada 90 dias ou após qualquer mudança relevante. Desvio de controle só é aceito com justificativa, compensação e aprovador registrados.',
      ),
      section('🪪', 'Identificação do ativo'),
      field('Servidor ou VM'),
      field('Ambiente', 'Produção / Homologação / Desenvolvimento'),
      field('Sistema operacional e versão'),
      field('Dono do ativo'),
      field('Data da revisão'),
      field('Revisor'),
      section('🔑', 'Acesso e identidade'),
      check(bold('Login root direto desabilitado no SSH: '), code('PermitRootLogin no')),
      check(
        bold('Autenticação por senha desativada (só chave pública): '),
        code('PasswordAuthentication no'),
      ),
      check('Usuários sem necessidade de acesso removidos ou com shell em nologin.'),
      check('Grupos e privilégios sudo revisados pelo menor privilégio.'),
      check('Segredos fora do repositório e com rotina de rotação definida.'),
      section('🌐', 'Rede e exposição'),
      check('Firewall em política padrão negar, liberando apenas portas de negócio.'),
      check('Serviços de administração restritos à rede de gestão ou VPN.'),
      check('IPv6 desabilitado quando não é usado (evita bypass do firewall).'),
      check('Sensor/EDR instalado, ativo e reportando ao coletor central.'),
      section('⚙️', 'Sistema e pacotes'),
      check('Pacotes do sistema atualizados com os patches de segurança.'),
      check('Serviços e contas desnecessários desinstalados ou desativados.'),
      check('Sincronismo de hora (NTP) configurado e estável.'),
      check('Política de retenção de logs definida (mínimo 90 dias online).'),
      section('📡', 'Registro e monitoramento'),
      check('Logs de sistema e autenticação enviados ao coletor central.'),
      check('Monitoramento de disco, CPU, memória e serviços críticos ativo.'),
      check('Alertas encaminhados ao canal do plantão e testados.'),
      section('💾', 'Resiliência de dados'),
      check('Backup configurado conforme a política 3-2-1.'),
      check('Restauração testada na última janela (registrar a data).'),
      check('RTO e RPO documentados para o ativo.'),
      section('⚠️', 'Desvios'),
      table(
        ['Controle', 'Justificativa', 'Compensação', 'Aprovador'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      section('📊', 'Conformidade'),
      field('Controles conformes', 'NN de NN'),
      field('Próxima revisão', 'DD/MM/AAAA'),
      check('Resultado comunicado ao dono do ativo.'),
    ],
  },
  {
    name: 'Matriz de risco',
    icon: '🎯',
    category: 'Segurança',
    description:
      'Avaliação de riscos com escore probabilidade × impacto, plano de tratamento e aceite formal.',
    blocks: [
      callout(
        '💡',
        'Como usar: identifique os riscos com a área dona, calcule o escore (probabilidade × impacto) e defina o tratamento: mitigar, transferir, evitar ou aceitar.',
      ),
      section('📏', 'Critérios de avaliação'),
      table(
        ['Nível', 'Escore', 'Ação esperada'],
        [
          ['Crítico', '20–25', 'Tratar imediatamente; plano em até 7 dias'],
          ['Alto', '12–19', 'Tratar em até 30 dias; controles compensatórios'],
          ['Médio', '6–11', 'Tratar em até 90 dias'],
          ['Baixo', '1–5', 'Aceitar e monitorar'],
        ],
      ),
      table(
        ['Escala', '1', '2', '3', '4', '5'],
        [
          ['Probabilidade', 'Rara', 'Improvável', 'Possível', 'Provável', 'Quase certa'],
          ['Impacto', 'Insignificante', 'Menor', 'Moderado', 'Maior', 'Severo'],
        ],
      ),
      section('🗂️', 'Registro de riscos'),
      table(
        ['Risco', 'Ativo / processo', 'Prob.', 'Impacto', 'Escore', 'Controles atuais', 'Dono'],
        [
          ['', '', '', '', '', '', ''],
          ['', '', '', '', '', '', ''],
          ['', '', '', '', '', '', ''],
        ],
      ),
      section('🩹', 'Plano de tratamento'),
      table(
        ['Risco', 'Ação de tratamento', 'Responsável', 'Prazo'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      bullet(txt('Tratamento: ', ['bold']), 'mitigar / transferir / evitar / aceitar (justificar)'),
      section('✍️', 'Aprovação'),
      field('Avaliado por'),
      field('Aprovado por'),
      field('Próxima revisão', 'DD/MM/AAAA'),
      ...changelog(),
    ],
  },
  {
    name: 'Revisão de acessos',
    icon: '🔑',
    category: 'Segurança',
    description:
      'Revisão periódica de contas e privilégios: quem ainda precisa de acesso, o que revogar e evidência da execução.',
    blocks: [
      callout(
        '💡',
        'Como usar: revise a cada trimestre ou sempre que alguém sair de área. Toda revogação precisa de data e responsável registrados.',
      ),
      section('📌', 'Escopo'),
      field('Período revisado', 'DD/MM/AAAA a DD/MM/AAAA'),
      field('Sistemas incluídos'),
      field('Revisor'),
      field('Data da revisão'),
      section('👥', 'Contas revisadas'),
      table(
        ['Usuário', 'Sistema', 'Perfil', 'Último acesso', 'Decisão (manter / revogar)'],
        [
          ['', '', '', '', ''],
          ['', '', '', '', ''],
          ['', '', '', '', ''],
        ],
      ),
      section('🔍', 'Checklist'),
      check('Contas de serviço e integrações revisadas (tokens e chaves vigentes).'),
      check('Acessos administrativos confirmados como necessários e com MFA.'),
      check('Contas de colaboradores desligados ou transferidos já revogadas.'),
      check('Grupos e papéis conferidos pelo princípio do menor privilégio.'),
      check('Amostra de 10% dos acessos validada com os donos dos sistemas.'),
      section('🗑️', 'Revogações executadas'),
      table(
        ['Conta', 'Sistema', 'Data', 'Responsável'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      section('📄', 'Aprovação'),
      field('Executado por'),
      field('Aprovado por'),
      field('Próxima revisão', 'DD/MM/AAAA'),
    ],
  },
  {
    name: 'Procedimento de mudança em produção',
    icon: '🔄',
    category: 'Infraestrutura',
    description:
      'RFC com pré-requisitos bloqueantes, execução cronometrada, gatilhos de rollback e pós-mudança.',
    blocks: [
      callout(
        '💡',
        'Como usar: envie para aprovação com no mínimo 1 dia útil de antecedência. Mudança não programada usa a seção "Emergência" e exige regularização em até 1 dia útil.',
      ),
      section('📋', 'Resumo da mudança'),
      field('RFC / ID'),
      field('Solicitante'),
      field('Responsável técnico'),
      field('Aprovador (CAB)'),
      field('Janela', 'DD/MM/AAAA HH:MM → HH:MM'),
      field('Duração estimada'),
      field('Risco', 'Baixo / Médio / Alto'),
      field('Impacto visível ao usuário', 'Sim / Não'),
      section('🎯', 'Escopo e impacto'),
      field('Sistemas afetados'),
      field('Usuários e serviços afetados'),
      field('Dependências e integrações'),
      field('Comunicação planejada', 'canal, público e horário'),
      section('✅', 'Pré-requisitos (bloqueiam o início)'),
      check('Aprovação registrada (nome e data).'),
      check('Rollback testado em homologação.'),
      check('Backup ou snapshot do estado atual realizado.'),
      check('Versão do artefato identificada (versão/hash) e íntegra.'),
      check('Monitoramento e dashboards abertos na janela.'),
      check('Plantão e áreas impactadas avisados.'),
      section('🛠️', 'Execução (passo a passo)'),
      step(bold('Passo 1 — '), 'ação; esperado: resultado esperado'),
      step(bold('Passo 2 — '), 'ação; esperado: resultado esperado'),
      step(bold('Passo 3 — '), 'ação; esperado: resultado esperado'),
      para(
        txt('Registre a hora real de cada passo: é ela que sustenta a decisão de rollback.', [
          'italic',
        ]),
      ),
      field('Hora real de início'),
      section('🔙', 'Gatilhos de rollback'),
      table(
        ['Gatilho', 'Ação', 'Responsável'],
        [
          ['Erro acima de 5% por mais de 5 minutos', 'Interromper e executar o rollback', ''],
          ['Latência p95 acima do limite aceito', 'Interromper e executar o rollback', ''],
          ['Falha em health check ou 2 passos seguidos', 'Interromper e validar estado', ''],
          ['Risco de perda de integridade de dados', 'Parar tudo e acionar o plantão', ''],
        ],
      ),
      step('Avisar no canal da janela e registrar a hora.'),
      step('Executar o rollback na ordem inversa e validar o funcionamento.'),
      step('Registrar causa e resultado do rollback.'),
      section('🔍', 'Pós-mudança'),
      check('Monitoramento sem alertas por 30 minutos.'),
      check('Testes de fumaça concluídos com sucesso.'),
      check('Comunicação de conclusão enviada.'),
      check('Pendências identificadas registradas com responsável e prazo.'),
      section('🚨', 'Emergência (mudança não programada)'),
      para(
        'Aprovação verbal do responsável de plantão, registrada no canal de incidentes, com regularização deste RFC em até 1 dia útil.',
      ),
      ...changelog(),
    ],
  },
  {
    name: 'Backup e restauração',
    icon: '💾',
    category: 'Infraestrutura',
    description:
      'Política 3-2-1, janelas e retenção por serviço, testes de restauração e registro de resultados.',
    blocks: [
      callout(
        '💡',
        'Como usar: mantenha a tabela de janelas sempre atualizada e registre TODA restauração de teste — backup que nunca foi restaurado não é backup.',
      ),
      section('📐', 'Política'),
      quote(
        bold('3-2-1: '),
        'três cópias do dado, em dois meios diferentes, sendo uma cópia fora do local.',
      ),
      field('Responsável pela política'),
      field('Frequência de revisão', 'trimestral'),
      section('🗓️', 'Janelas e retenção'),
      table(
        ['Serviço', 'Janela', 'Retenção', 'RTO', 'RPO', 'Último teste'],
        [
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
        ],
      ),
      section('✅', 'Checklist operacional'),
      check('Backup do período concluído sem erros.'),
      check('Alertas de falha de backup encaminhados ao plantão.'),
      check('Verificação de integridade/amostra executada.'),
      check('Cópia fora do local confirmada.'),
      check('Espaço de armazenamento monitorado.'),
      section('🧯', 'Restauração (passo a passo)'),
      step('Identificar o ponto de restauração (data/hora) e o escopo afetado.'),
      step('Comunicar a janela e congelar alterações no ambiente de destino.'),
      step('Executar a restauração conforme a ferramenta do serviço.'),
      step('Validar dados, integridades e funcionamento das aplicações.'),
      step('Registrar o resultado e eventuais perdas (RPO efetivo).'),
      section('📝', 'Registro de testes'),
      table(
        ['Data', 'Escopo', 'Resultado', 'Responsável'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
    ],
  },
  {
    name: 'Ficha de ativo',
    icon: '🖥️',
    category: 'Infraestrutura',
    description:
      'Cadastro único do ativo: propriedade, criticidade, dependências, segurança, backup e ciclo de vida.',
    blocks: [
      callout(
        '💡',
        'Como usar: crie uma ficha por ativo crítico e mantenha na mesma pasta do projeto. Atualize a ficha a cada mudança estrutural.',
      ),
      section('🪪', 'Identificação'),
      field('Nome do ativo'),
      field('Tipo', 'servidor, VM, appliance, nuvem, aplicação'),
      field('Endereço / URL'),
      field('Ambiente', 'Produção / Homologação / Desenvolvimento'),
      field('Sistema e versão'),
      field('Local / provedor'),
      section('👑', 'Propriedade'),
      field('Dono do negócio'),
      field('Responsável técnico'),
      field('Criticidade', 'Crítica / Alta / Média / Baixa'),
      field('Janela de atendimento'),
      section('🔗', 'Dependências'),
      bullet('Sistemas que dependem deste ativo:'),
      bullet('Integrações e APIs consumidas:'),
      bullet('Contrato de suporte / fornecedor:'),
      section('🛡️', 'Segurança'),
      check('Revisão de hardening concluída (vincular checklist).'),
      check('Vulnerabilidades abertas monitoradas.'),
      check('Acessos administrativos restritos e revisados.'),
      check('Certificados e credenciais com data de expiração registrada.'),
      section('💾', 'Backup e monitoramento'),
      check('Backup configurado (vincular à política 3-2-1).'),
      check('Monitoramento de disponibilidade e recursos ativo.'),
      check('Alertas encaminhados ao canal do plantão.'),
      section('📆', 'Ciclo de vida'),
      field('Data de aquisição/implantação'),
      field('Garantia até'),
      field('Fim de vida previsto'),
      ...changelog(),
    ],
  },
  {
    name: 'Ata de reunião',
    icon: '📝',
    category: 'Gestão',
    description:
      'Decisões rastreáveis e ações com responsável, prazo e status — reuniões de equipe e de governança.',
    blocks: [
      callout(
        '💡',
        'Como usar: distribua em até 24 horas. Decisões e ações são obrigatórias: ação sem responsável e prazo não entra na ata.',
      ),
      section('🗓️', 'Dados da reunião'),
      field('Data e hora'),
      field('Local ou link'),
      field('Conduzido por'),
      field('Participantes'),
      field('Ausentes (com motivo)'),
      field('Duração'),
      section('📋', 'Pauta'),
      step(bold('1. '), 'tópico (min)'),
      step(bold('2. '), 'tópico (min)'),
      step(bold('3. '), 'tópico (min)'),
      section('💬', 'Discussão'),
      bullet(
        txt('Tópico — ', ['bold']),
        'pontos principais, divergências e o que ficou para decidir',
      ),
      section('✅', 'Decisões'),
      bullet(bold('D1 — '), 'decisão; quem decidiu; data de revisão'),
      bullet(bold('D2 — '), 'decisão; quem decidiu; data de revisão'),
      section('📌', 'Ações'),
      table(
        ['Ação', 'Responsável', 'Prazo', 'Status'],
        [
          ['', '', '', 'Pendente'],
          ['', '', '', 'Pendente'],
        ],
      ),
      section('⚠️', 'Riscos e pendências'),
      table(
        ['Risco', 'Impacto', 'Dono', 'Mitigação'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      section('🔜', 'Próxima reunião'),
      field('Data e horário'),
      field('Pauta preliminar'),
      section('📤', 'Distribuição'),
      field('Enviada em', 'DD/MM/AAAA'),
      field('Para', 'destinatários'),
    ],
  },
  {
    name: 'Onboarding de colaborador',
    icon: '🙋',
    category: 'Gestão',
    description:
      'Entrada de novo time: acessos, equipamentos, treinamentos e marcos de 30/60/90 dias.',
    blocks: [
      callout(
        '💡',
        'Como usar: abra a ficha assim que a admissão for confirmada e marque cada item com o responsável e a data.',
      ),
      section('👤', 'Dados'),
      field('Nome'),
      field('Cargo / função'),
      field('Gestor responsável'),
      field('Área'),
      field('Data de início', 'DD/MM/AAAA'),
      section('🗓️', 'Antes do dia 1'),
      check('Contas e acessos criados (e-mail, VPN, sistemas internos).'),
      check('Equipamento configurado e testado.'),
      check('Crachá e acesso físico solicitados.'),
      check('Boas-vindas e pauta da primeira semana enviadas.'),
      section('🎉', 'Dia 1'),
      check('Apresentação à equipe e ao gestor.'),
      check('Tour dos ambientes e ferramentas.'),
      check('Políticas de segurança e uso aceitas.'),
      check('Equipamentos e credenciais entregues.'),
      section('📅', 'Primeira semana'),
      check('Acessos aos sistemas do dia a dia conferidos.'),
      check('Treinamentos obrigatórios concluídos.'),
      check('Dupla (buddy) definida.'),
      check('Rituais da equipe apresentados.'),
      section('🎯', 'Marcos de 30/60/90 dias'),
      table(
        ['Marco', 'Meta', 'Status'],
        [
          ['30 dias', 'Autonomia nas tarefas do escopo', ''],
          ['60 dias', 'Contribuição com entregas acompanhadas', ''],
          ['90 dias', 'Avaliação de período confirmada', ''],
        ],
      ),
      section('📌', 'Tarefas'),
      table(
        ['Tarefa', 'Responsável', 'Prazo', 'Status'],
        [
          ['', '', '', 'Pendente'],
          ['', '', '', 'Pendente'],
        ],
      ),
      toggle('📎 Anexos e documentos', [
        bullet('Contrato / admissão'),
        bullet('Termo de confidencialidade'),
        bullet('Termo de uso de recursos'),
      ]),
    ],
  },
  {
    name: 'Painel de indicadores (KPIs)',
    icon: '📈',
    category: 'Gestão',
    description:
      'Indicadores mensais de segurança e operação: metas, valores atuais, tendência e análise.',
    blocks: [
      callout(
        '💡',
        'Como usar: atualize no primeiro dia útil de cada mês. Indicador sem meta e sem responsável vira achismo.',
      ),
      section('📊', 'Indicadores do período'),
      table(
        ['Indicador', 'Meta', 'Atual', 'Tendência', 'Responsável'],
        [
          ['MTTD — tempo até a detecção', '', '', '→', ''],
          ['MTTC — tempo até a contenção', '', '', '→', ''],
          ['MTTR — tempo até a recuperação', '', '', '→', ''],
          ['Vulnerabilidades críticas acima do prazo', '', '', '→', ''],
          ['Cobertura de backup com teste de restore', '', '', '→', ''],
          ['Disponibilidade dos serviços críticos', '', '', '→', ''],
        ],
      ),
      section('📐', 'Definições'),
      toggle('Significados e fórmulas', [
        bullet(bold('MTTD: '), 'da detecção até o alerta confirmado'),
        bullet(bold('MTTC: '), 'do alerta até a contenção efetiva'),
        bullet(bold('MTTR: '), 'do início até a recuperação plena'),
        bullet(bold('Tendência: '), '▲ piorando · ▼ melhorando · → estável'),
      ]),
      section('📈', 'Análise do período'),
      bullet('O que mudou em relação ao mês anterior:'),
      bullet('Causas dos desvios da meta:'),
      bullet('Ações corretivas com responsável e prazo:'),
      section('🎯', 'Metas do trimestre'),
      table(
        ['Meta', 'Responsável', 'Prazo', 'Progresso'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      section('📤', 'Distribuição'),
      field('Enviado em', 'DD/MM/AAAA'),
      field('Para', 'destinatários'),
    ],
  },
  {
    name: 'SOP — Procedimento operacional padrão',
    icon: '📘',
    category: 'Documentação',
    description:
      'Modelo de procedimento repetível: objetivo, responsáveis, passos, pontos de atenção e histórico.',
    blocks: [
      callout(
        '💡',
        'Como usar: descreva o procedimento para que alguém de outra equipe consiga executar sem te perguntar nada.',
      ),
      section('🎯', 'Objetivo'),
      para('O que este procedimento garante e por que ele existe.'),
      section('🧭', 'Escopo'),
      bullet('Aplica-se a:'),
      bullet('Não se aplica a:'),
      section('👥', 'Responsáveis'),
      table(
        ['Papel', 'Quem', 'Responsabilidade'],
        [
          ['Executor', '', ''],
          ['Aprovador', '', ''],
          ['Consultado', '', ''],
        ],
      ),
      section('📦', 'Pré-requisitos e materiais'),
      check('Acessos e permissões necessários.'),
      check('Ferramentas e versões exigidas.'),
      check('Aprovação/documento de referência.'),
      section('⚙️', 'Procedimento'),
      step(bold('Passo 1 — '), 'ação; resultado esperado'),
      sub('Regra de decisão'),
      bullet('Se ', bold('condição'), ', então ação X; senão ação Y e acione o responsável.'),
      step(bold('Passo 2 — '), 'ação; resultado esperado'),
      step(bold('Passo 3 — '), 'ação; resultado esperado'),
      section('⚠️', 'Pontos de atenção'),
      callout('⚠️', 'Aqui vão os erros que já aconteceram e como evitá-los.', 'yellow'),
      bullet('Nunca execute este passo sem backup confirmado.'),
      bullet('Dúvida em qualquer etapa: pare e acione o responsável.'),
      section('🧯', 'Se algo der errado'),
      bullet('Como reverter:'),
      bullet('Quem acionar:'),
      bullet('Como registrar o desvio:'),
      ...changelog(),
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Semente e atualização                                                       */
/* -------------------------------------------------------------------------- */

interface SeedState {
  version: number;
  hashes: Record<string, string>;
  /** Nomes de modelos já conhecidos por este seed (apagados não voltam). */
  seen: string[];
}

function hashOf(contentJson: string): string {
  return createHash('sha256').update(contentJson).digest('hex').slice(0, 32);
}

/** Lê o marcador; nas versões 1–2 o valor era o texto simples `'1'`. */
function readState(db: Db): SeedState | null {
  const row = db
    .prepare<[string], { value: string }>(`SELECT value FROM settings WHERE key = ?`)
    .get(DEFAULT_TEMPLATES_SEEDED_KEY);
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && 'version' in parsed) {
      const state = parsed as Partial<SeedState>;
      return {
        version: state.version ?? 1,
        hashes: state.hashes ?? {},
        seen: state.seen ?? LEGACY_TEMPLATE_NAMES.slice(),
      };
    }
  } catch {
    // Valor legado ('1'): caia no estado abaixo.
  }
  return { version: 1, hashes: {}, seen: LEGACY_TEMPLATE_NAMES.slice() };
}

/**
 * Cria os modelos padrão na primeira inicialização e, quando
 * `DEFAULT_TEMPLATES_VERSION` sobe, regrava os que ninguém editou e cria os
 * modelos novos acrescentados à lista. Devolve quantos foram criados/alterados.
 */
export function seedDefaultTemplates(db: Db, options: { force?: boolean } = {}): number {
  const state = readState(db);
  const needsContentUpdate = state === null || state.version < DEFAULT_TEMPLATES_VERSION;
  if (!needsContentUpdate && !options.force) return 0;

  const now = new Date().toISOString();
  const hashes: Record<string, string> = { ...(state?.hashes ?? {}) };
  const known = new Set(state?.seen ?? []);
  let changed = 0;

  const apply = db.transaction(() => {
    let folderId = '';

    for (const template of DEFAULT_TEMPLATES) {
      const desiredJson = JSON.stringify(template.blocks);
      const desiredHash = hashOf(desiredJson);

      const marked = db
        .prepare<[string], { node_id: string }>(`SELECT node_id FROM templates WHERE name = ?`)
        .get(template.name);

      if (marked) {
        known.add(template.name);
        // Já é modelo: atualiza metadados e (se ninguém editou) o conteúdo.
        db.prepare(
          `UPDATE templates SET category = ?, description = ?, updated_at = ? WHERE node_id = ?`,
        ).run(template.category, template.description, now, marked.node_id);

        const node = db
          .prepare<[string], { current_version: number }>(
            `SELECT current_version FROM nodes WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(marked.node_id);
        if (!node) continue;

        const current = db
          .prepare<[string, number], { content_json: string }>(
            `SELECT content_json FROM page_versions WHERE node_id = ? AND version = ?`,
          )
          .get(marked.node_id, node.current_version);
        if (!current) continue;
        if (current.content_json === desiredJson) {
          hashes[template.name] = desiredHash;
          continue;
        }

        const storedHash = hashes[template.name];
        const untouched =
          (storedHash !== undefined && storedHash === hashOf(current.content_json)) ||
          // Migração da semente v1: a única versão é a que o seed gravou.
          (state !== null && state.version === 1 && node.current_version === 1);
        if (!untouched) continue;

        db.prepare(
          `INSERT INTO page_versions (id, node_id, version, content_json, title_snapshot, source, byte_size, created_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)`,
        ).run(
          newId(),
          marked.node_id,
          node.current_version + 1,
          desiredJson,
          template.name,
          Buffer.byteLength(desiredJson, 'utf8'),
          now,
        );
        // Ícone (Notion): só preenche se a página ainda não tem um.
        db.prepare(
          `UPDATE nodes SET current_version = ?, search_text = ?, icon = COALESCE(icon, ?), updated_at = ? WHERE id = ?`,
        ).run(
          node.current_version + 1,
          blocksToPlainText(template.blocks),
          template.icon,
          now,
          marked.node_id,
        );
        hashes[template.name] = desiredHash;
        changed += 1;
        continue;
      }

      // Não é mais modelo. Só criamos se for a primeira semente, um modelo
      // NOVO (nunca visto) ou restauração explícita — apagado não volta.
      if (known.has(template.name) && !options.force) continue;

      if (!folderId) {
        const existingFolder = db
          .prepare<[string], { id: string }>(
            `SELECT id FROM nodes WHERE type = 'folder' AND parent_id IS NULL AND title = ? AND deleted_at IS NULL`,
          )
          .get(FOLDER_TITLE);
        if (existingFolder) {
          folderId = existingFolder.id;
        } else {
          folderId = newId();
          db.prepare(
            `INSERT INTO nodes (id, type, parent_id, title, position, created_at, updated_at)
             VALUES (?, 'folder', NULL, ?, 0, ?, ?)`,
          ).run(folderId, FOLDER_TITLE, now, now);
        }
      }

      const existingPage = db
        .prepare<[string, string], { id: string }>(
          `SELECT id FROM nodes WHERE parent_id = ? AND title = ? AND deleted_at IS NULL`,
        )
        .get(folderId, template.name);

      let pageId = existingPage?.id ?? '';
      if (pageId) {
        db.prepare(`UPDATE nodes SET is_template = 1, updated_at = ? WHERE id = ?`).run(
          now,
          pageId,
        );
      } else {
        const positionRow = db
          .prepare<[string], { next: number }>(
            `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM nodes WHERE parent_id IS ? AND deleted_at IS NULL`,
          )
          .get(folderId);
        pageId = newId();
        db.prepare(
          `INSERT INTO nodes (id, type, parent_id, title, icon, position, is_template, created_at, updated_at)
           VALUES (?, 'page', ?, ?, ?, ?, 1, ?, ?)`,
        ).run(pageId, folderId, template.name, template.icon, positionRow?.next ?? 0, now, now);

        db.prepare(
          `INSERT INTO page_versions (id, node_id, version, content_json, title_snapshot, source, byte_size, created_at)
           VALUES (?, ?, 1, ?, ?, 'manual', ?, ?)`,
        ).run(
          newId(),
          pageId,
          desiredJson,
          template.name,
          Buffer.byteLength(desiredJson, 'utf8'),
          now,
        );
        db.prepare(`UPDATE nodes SET current_version = 1, search_text = ? WHERE id = ?`).run(
          blocksToPlainText(template.blocks),
          pageId,
        );
      }

      const categoryPosition = db
        .prepare<[string], { next: number }>(
          `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM templates WHERE category = ?`,
        )
        .get(template.category);
      db.prepare(
        `INSERT INTO templates (node_id, name, category, description, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pageId,
        template.name,
        template.category,
        template.description,
        categoryPosition?.next ?? 0,
        now,
        now,
      );
      hashes[template.name] = desiredHash;
      known.add(template.name);
      changed += 1;
    }

    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(
      DEFAULT_TEMPLATES_SEEDED_KEY,
      JSON.stringify({
        version: Math.max(state?.version ?? 0, DEFAULT_TEMPLATES_VERSION),
        hashes,
        seen: [...known],
      }),
      now,
    );
  });
  apply();

  if (changed > 0) {
    logActivity(db, {
      actorId: null,
      action: 'template.seed_defaults',
      entityType: 'node',
      summary: `${changed} modelos padrão criados/atualizados`,
    });
  }
  return changed;
}
