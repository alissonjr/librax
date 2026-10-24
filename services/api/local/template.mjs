/**
 * Plano do ambiente local tirado do template sintetizado da infra (infra/local/synth.ts).
 *
 * O template e a fonte unica: a tabela, o User Pool, os clients, o grupo, o IdP do Google, as
 * rotas da HTTP API com os autorizadores, o gatilho PostConfirmation e os jobs do Scheduler saem
 * daqui. Nada de lista de rotas escrita a mao: rota nova na infra aparece no servidor local, e
 * rota sem handler local faz o servidor recusar subir.
 *
 * Funcao pura (sem I/O), testada em test/localTemplate.test.js.
 */

const byType = (resources, type) => Object.entries(resources).filter(([, r]) => r.Type === type);

function oneOf(resources, type) {
  const found = byType(resources, type);
  if (found.length !== 1) throw new Error(`template: esperado 1 ${type}, achei ${found.length}`);
  return found[0];
}

/** Logical id de um { Ref } ou { Fn::GetAtt: [id, attr] }. */
function refId(value) {
  if (value?.Ref) return value.Ref;
  if (Array.isArray(value?.['Fn::GetAtt'])) return value['Fn::GetAtt'][0];
  return null;
}

/**
 * Resolve as funcoes intrinsecas que o ambiente local entende (Ref, Fn::GetAtt e Fn::Join).
 * `refs` mapeia logical id para o valor fisico; `atts` mapeia "id.Atributo". O que nao da para
 * resolver vira null (ex.: dominio do CloudFront).
 */
export function resolveValue(value, { refs = {}, atts = {} } = {}) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, { refs, atts }));
  if ('Ref' in value) return refs[value.Ref] ?? null;
  if ('Fn::GetAtt' in value) {
    const [id, attr] = value['Fn::GetAtt'];
    return atts[`${id}.${attr}`] ?? null;
  }
  if ('Fn::Join' in value) {
    const [sep, parts] = value['Fn::Join'];
    const resolved = parts.map((p) => resolveValue(p, { refs, atts }));
    return resolved.some((p) => p === null) ? null : resolved.join(sep);
  }
  return null;
}

const strings = (list) => (list ?? []).filter((v) => typeof v === 'string');

/**
 * @param {object} template  template do CloudFormation (JSON)
 * @param {{region: string}} opts
 */
export function readPlan(template, { region }) {
  const R = template.Resources ?? {};

  // --- DynamoDB --------------------------------------------------------------
  const [, tableRes] = oneOf(R, 'AWS::DynamoDB::Table');
  const t = tableRes.Properties;
  const table = {
    TableName: t.TableName,
    KeySchema: t.KeySchema,
    AttributeDefinitions: t.AttributeDefinitions,
    GlobalSecondaryIndexes: t.GlobalSecondaryIndexes ?? [],
    BillingMode: t.BillingMode,
    ttlAttribute: t.TimeToLiveSpecification?.Enabled ? t.TimeToLiveSpecification.AttributeName : null,
  };

  // --- Lambdas: nome fisico, handler exportado e variaveis -----------------------
  const functionNames = Object.fromEntries(
    byType(R, 'AWS::Lambda::Function').map(([id, r]) => [id, r.Properties.FunctionName ?? id]),
  );
  const fnName = (value) => functionNames[refId(value)] ?? null;

  // --- Cognito ---------------------------------------------------------------
  const [poolId, poolRes] = oneOf(R, 'AWS::Cognito::UserPool');
  const { LambdaConfig = {}, UserPoolTier, ...poolProps } = poolRes.Properties;
  const userPool = {
    logicalId: poolId,
    name: poolProps.UserPoolName,
    // UserPoolTier (plano Lite) nao existe no moto; os gatilhos o servidor local chama sozinho
    props: poolProps,
    tier: UserPoolTier ?? null,
    postConfirmation: LambdaConfig.PostConfirmation ? fnName(LambdaConfig.PostConfirmation) : null,
  };

  const clients = byType(R, 'AWS::Cognito::UserPoolClient').map(([id, r]) => {
    const { UserPoolId, ...props } = r.Properties;
    return {
      logicalId: id,
      // O app client nao tem ClientName no CDK, e o moto exige um: usa o logical id
      name: props.ClientName ?? id,
      props: {
        ...props,
        ClientName: props.ClientName ?? id,
        CallbackURLs: strings(props.CallbackURLs),
        LogoutURLs: strings(props.LogoutURLs),
      },
    };
  });

  const groups = byType(R, 'AWS::Cognito::UserPoolGroup').map(([, r]) => {
    const { UserPoolId, ...props } = r.Properties;
    return props;
  });

  const identityProviders = byType(R, 'AWS::Cognito::UserPoolIdentityProvider').map(([, r]) => ({
    ProviderName: r.Properties.ProviderName,
    ProviderType: r.Properties.ProviderType,
    AttributeMapping: r.Properties.AttributeMapping ?? {},
  }));

  // --- HTTP API --------------------------------------------------------------
  const [apiId, apiRes] = oneOf(R, 'AWS::ApiGatewayV2::Api');
  const stages = byType(R, 'AWS::ApiGatewayV2::Stage').map(([, r]) => r.Properties.StageName);
  const authorizers = Object.fromEntries(
    byType(R, 'AWS::ApiGatewayV2::Authorizer').map(([id, r]) => {
      const p = r.Properties;
      if (p.AuthorizerType !== 'JWT') throw new Error(`template: autorizador ${id} nao e JWT`);
      const issuerRef = refId(p.JwtConfiguration.Issuer);
      if (issuerRef !== poolId) throw new Error(`template: autorizador ${id} com emissor fora do User Pool`);
      return [id, {
        name: p.Name,
        identitySource: p.IdentitySource ?? ['$request.header.Authorization'],
        // os ids dos clients so existem depois do bootstrap: guarda os logical ids
        audience: p.JwtConfiguration.Audience.map((a) => {
          const id2 = refId(a);
          if (!id2) throw new Error(`template: audiencia sem Ref no autorizador ${id}`);
          return id2;
        }),
      }];
    }),
  );

  const routes = byType(R, 'AWS::ApiGatewayV2::Route').map(([id, r]) => {
    const p = r.Properties;
    const join = p.Target?.['Fn::Join']?.[1] ?? [];
    const integrationId = refId(join.find((part) => typeof part === 'object'));
    const integration = R[integrationId]?.Properties;
    if (!integration) throw new Error(`template: rota ${p.RouteKey} sem integracao`);
    if (integration.PayloadFormatVersion !== '2.0') throw new Error(`template: rota ${p.RouteKey} nao usa o payload 2.0`);
    const fnId = refId(integration.IntegrationUri);
    const fn = R[fnId]?.Properties;
    if (!fn) throw new Error(`template: rota ${p.RouteKey} sem Lambda`);
    const [method, ...pathParts] = p.RouteKey.split(' ');
    return {
      routeKey: p.RouteKey,
      method,
      path: pathParts.join(' '),
      functionName: fn.FunctionName ?? fnId,
      handler: String(fn.Handler).replace(/^index\./, ''),
      authorizationType: p.AuthorizationType ?? 'NONE',
      authorizer: p.AuthorizerId ? refId(p.AuthorizerId) : null,
      routeId: id,
    };
  });

  // --- Variaveis das Lambdas (as que o ambiente local sabe resolver) ------------
  const refs = { ...functionNames, [apiId]: 'librax-local-api' };
  for (const [id, r] of byType(R, 'AWS::DynamoDB::Table')) refs[id] = r.Properties.TableName;
  for (const [id, r] of byType(R, 'AWS::ApiGatewayV2::Stage')) refs[id] = r.Properties.StageName;
  const functions = Object.fromEntries(
    byType(R, 'AWS::Lambda::Function').map(([id, r]) => {
      const vars = r.Properties.Environment?.Variables ?? {};
      return [functionNames[id], {
        logicalId: id,
        handler: String(r.Properties.Handler).replace(/^index\./, ''),
        // USER_POOL_ID depende do bootstrap: fica o logical id para resolver depois
        environment: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v?.Ref === poolId ? { userPool: true } : resolveValue(v, { refs })])),
      }];
    }),
  );

  // --- Scheduler -------------------------------------------------------------
  const schedules = [
    ...byType(R, 'AWS::Scheduler::Schedule'),
  ].map(([, r]) => ({
    name: r.Properties.Name,
    expression: r.Properties.ScheduleExpression,
    timezone: r.Properties.ScheduleExpressionTimezone ?? 'UTC',
    functionName: fnName(r.Properties.Target?.Arn),
  }));

  const cors = apiRes.Properties.CorsConfiguration ?? null;

  return {
    region,
    table,
    userPool,
    clients,
    groups,
    identityProviders,
    api: {
      name: apiRes.Properties.Name,
      stage: stages.length === 1 ? stages[0] : null,
      cors,
      authorizers,
      routes,
    },
    functions,
    schedules,
  };
}

/** Emissor dos tokens do User Pool, como o Fn::GetAtt ProviderURL da infra resolve na AWS. */
export const issuerFor = (region, userPoolId) => `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
