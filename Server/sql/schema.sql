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