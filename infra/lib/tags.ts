import { Tags } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Etiqueta do projeto em tudo que a AWS deixa etiquetar (Lambda, tabela, buckets, CloudFront, Cognito,
 * alarmes, papéis, a conexão do CI...), para achar e somar os recursos do Librax (Tag Editor, Cost
 * Explorer). O que o script cria fora da stack (parâmetros do SSM, segredo do Google, bootstrap do CDK)
 * leva a mesma (lancar-cloudshell.sh, ETIQUETA).
 *
 * Só em recursos, nunca na stack: a etiqueta da stack o CloudFormation repassa a todos os recursos, e
 * nos que só aceitam etiqueta na criação isso pode recriar o recurso. Pelo mesmo motivo ficam de fora o
 * monitor e o aviso de anomalia de custo (ResourceTags "Update requires: Replacement"; o monitor de
 * serviços é um só por conta, recriar travaria o deploy). O orçamento recebe à parte (ResourceTags, sem
 * Tags do CDK). Nas outras, acrescentar a etiqueta atualiza no lugar ("No interruption").
 */
export const PROJECT_TAG = { key: 'project', value: 'librax' } as const;

export const UNTAGGED_TYPES = ['aws:cdk:stack', 'AWS::CE::AnomalyMonitor', 'AWS::CE::AnomalySubscription'];

export function tagProject(scope: IConstruct): void {
  Tags.of(scope).add(PROJECT_TAG.key, PROJECT_TAG.value, { excludeResourceTypes: UNTAGGED_TYPES });
}
