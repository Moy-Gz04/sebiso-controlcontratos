-- =========================================================
-- Esquema: Control de Contratos (SEBISO)
-- Motor: PostgreSQL (NeonDB)
-- Ejecutar completo en el SQL Editor de Neon, en orden.
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------
-- Tabla: usuarios
-- ---------------------------------------------------------
CREATE TABLE usuarios (
  id             SERIAL PRIMARY KEY,
  usuario        VARCHAR(50) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- Tabla: contratos
-- ---------------------------------------------------------
CREATE TABLE contratos (
  id                SERIAL PRIMARY KEY,
  no_contrato       VARCHAR(100),
  no_requisicion    VARCHAR(100),
  fecha             DATE,
  proveedor         VARCHAR(255),
  descripcion       TEXT,
  modo_facturacion  VARCHAR(20) CHECK (modo_facturacion IN ('unico','mensual','bimestral','trimestral')),
  num_periodos      INT,
  tiene_anticipo    BOOLEAN NOT NULL DEFAULT FALSE,
  monto_anticipo    NUMERIC(14,2) NOT NULL DEFAULT 0,
  estatus           VARCHAR(20) NOT NULL DEFAULT 'oficio_capturado'
                     CHECK (estatus IN ('oficio_capturado','en_facturacion','completado')),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- Tabla: oficios
-- ---------------------------------------------------------
CREATE TABLE oficios (
  id            SERIAL PRIMARY KEY,
  contrato_id   INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('inicial','ampliacion','cancelacion')),
  folio         VARCHAR(100) NOT NULL,
  monto         NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
  fecha         DATE NOT NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oficios_contrato ON oficios(contrato_id);

CREATE UNIQUE INDEX idx_un_oficio_inicial_por_contrato
  ON oficios(contrato_id)
  WHERE tipo = 'inicial';

-- ---------------------------------------------------------
-- Tabla: facturas
-- (el saldo/avance NO se guarda aquí: se calcula siempre en
-- el cliente a partir de oficios + facturas, para que nunca
-- se desincronice de la fuente real)
-- ---------------------------------------------------------
CREATE TABLE facturas (
  id             SERIAL PRIMARY KEY,
  contrato_id    INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  periodo_tipo   VARCHAR(20) NOT NULL CHECK (periodo_tipo IN ('anticipo','pago')),
  periodo_index  INT NOT NULL,
  periodo_label  VARCHAR(50) NOT NULL,
  no_factura     VARCHAR(100) NOT NULL,
  fecha          DATE NOT NULL,
  monto          NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
  fecha_pago     DATE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contrato_id, periodo_tipo, periodo_index)
);

CREATE INDEX idx_facturas_contrato ON facturas(contrato_id);

-- ---------------------------------------------------------
-- Trigger: mantener actualizado_en al día en contratos
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contratos_actualizado
BEFORE UPDATE ON contratos
FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

-- ---------------------------------------------------------
-- Usuario semilla (cámbiale la contraseña apenas puedas)
-- usuario: admin   contraseña: admin123
-- ---------------------------------------------------------
INSERT INTO usuarios (usuario, password_hash)
VALUES ('admin', crypt('admin123', gen_salt('bf')));
-- Archivo del contrato (PDF, Word o imagen) ligado a cada pedido/contrato.
-- Se guarda en la base (no en el disco de Render, que se borra al desplegar).
CREATE TABLE IF NOT EXISTS pedido_archivos (
  id          SERIAL PRIMARY KEY,
  pedido_id   INTEGER NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  mime        TEXT NOT NULL,
  tamano      INTEGER NOT NULL,
  datos       BYTEA NOT NULL,
  subido_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Varios archivos por pedido, distinguidos por tipo: 'contrato' y 'entrega'
-- (documento opcional que se adjunta al registrar la entrega).
ALTER TABLE pedido_archivos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'contrato';
ALTER TABLE pedido_archivos DROP CONSTRAINT IF EXISTS pedido_archivos_pedido_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS pedido_archivos_pedido_tipo ON pedido_archivos (pedido_id, tipo);

-- Los archivos se guardan en una carpeta de Google Drive (ver src/drive.js);
-- aquí solo queda su ID. "datos" solo conserva archivos aún no migrados.
ALTER TABLE pedido_archivos ADD COLUMN IF NOT EXISTS drive_id TEXT;
ALTER TABLE pedido_archivos ALTER COLUMN datos DROP NOT NULL;

-- Flujo de 10 pasos (2026-10-06): oficio de autorización, contrarrecibo,
-- descripción de factura y reducción. Adecuación, reducción y entrega son opcionales.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aut_folio VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aut_monto NUMERIC(14,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aut_fecha DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS contrarecibo_no VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS contrarecibo_fecha DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS contrarecibo_cuenta VARCHAR(120);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS contrarecibo_monto NUMERIC(14,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS factura_descripcion TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reduccion_monto NUMERIC(14,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reduccion_fecha DATE;
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_estatus_check;
UPDATE pedidos SET estatus = 'pedido_creado' WHERE estatus NOT IN ('pedido_creado','oficio_autorizado','contrarecibo','adecuacion','factura_recibida','reduccion','entregado','en_contabilidad','en_pago','pagado') OR (estatus = 'entregado' AND aut_folio IS NULL);
ALTER TABLE pedidos ADD CONSTRAINT pedidos_estatus_check CHECK (estatus IN ('pedido_creado','oficio_autorizado','contrarecibo','adecuacion','factura_recibida','reduccion','entregado','en_contabilidad','en_pago','pagado'));

-- Varias facturas por contrato (2026-10-06): cada una con su propio seguimiento
-- (contabilidad → inicio de pago → pagada). Sus archivos van en pedido_archivos
-- con tipo 'factura-<id>' y el comprobante de pago con 'pago-<id>'.
CREATE TABLE IF NOT EXISTS pedido_facturas (
  id                 SERIAL PRIMARY KEY,
  pedido_id          INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  no_factura         VARCHAR(80) NOT NULL,
  fecha              DATE NOT NULL,
  descripcion        TEXT NOT NULL,
  monto              NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  fecha_contabilidad DATE,
  fecha_inicio_pago  DATE,
  fecha_pagado       DATE,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedido_facturas_pedido ON pedido_facturas (pedido_id);
