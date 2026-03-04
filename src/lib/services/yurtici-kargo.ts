import * as soap from "soap";

const PROD_WSDL =
  "http://webservices.yurticikargo.com:8080/KOPSWebServices/ShippingOrderDispatcherServices?wsdl";
const TEST_WSDL =
  "http://testwebservices.yurticikargo.com:8080/KOPSWebServices/ShippingOrderDispatcherServices?wsdl";

function getWsdlUrl() {
  return process.env.YURTICI_TEST_MODE === "1" ? TEST_WSDL : PROD_WSDL;
}

function getCredentials() {
  return {
    wsUserName: process.env.YURTICI_WS_USERNAME || "",
    wsPassword: process.env.YURTICI_WS_PASSWORD || "",
    wsLanguage: "TR",
    userLanguage: "TR",
  };
}

let cachedClient: soap.Client | null = null;

async function getClient(): Promise<soap.Client> {
  if (cachedClient) return cachedClient;
  cachedClient = await soap.createClientAsync(getWsdlUrl());
  return cachedClient;
}

export interface ShipmentParams {
  cargoKey: string;
  receiverName: string;
  receiverAddress: string;
  receiverPhone: string;
  receiverCity: string;
  receiverDistrict: string;
  receiverPostalCode?: string;
}

export interface ShipmentResult {
  success: boolean;
  cargoKey: string;
  errorMessage?: string;
}

export interface TrackingEvent {
  date: string;
  description: string;
  location: string;
}

export interface TrackingResult {
  success: boolean;
  events: TrackingEvent[];
  errorMessage?: string;
}

export async function createShipment(
  params: ShipmentParams
): Promise<ShipmentResult> {
  const client = await getClient();
  const creds = getCredentials();

  const args = {
    ...creds,
    ShippingOrderVO: {
      cargoKey: params.cargoKey,
      invoiceKey: params.cargoKey,
      receiverCustName: params.receiverName,
      receiverAddress: params.receiverAddress,
      receiverPhone1: params.receiverPhone,
      cityName: params.receiverCity,
      townName: params.receiverDistrict,
      ...(params.receiverPostalCode
        ? { receiverPostalCode: params.receiverPostalCode }
        : {}),
      cargoCount: 1,
      waybillNo: "",
      specialField1: "",
      specialField2: "",
      specialField3: "",
      ttDocumentId: "",
      dcSelectedCredit: "",
      dcCreditRule: 0,
      description: "Figurine Studio Siparis",
      orgGeoCode: "",
      arrivalTownName: "",
      arrivalCityName: "",
    },
  };

  const [result] = await client.createShipmentAsync(args);
  const outFlag = result?.ShippingOrderResultVO?.outFlag;

  if (outFlag === "0") {
    return { success: true, cargoKey: params.cargoKey };
  }

  return {
    success: false,
    cargoKey: params.cargoKey,
    errorMessage:
      result?.ShippingOrderResultVO?.errMessage || "Unknown Yurtici API error",
  };
}

export async function queryShipment(
  cargoKey: string
): Promise<TrackingResult> {
  const client = await getClient();
  const creds = getCredentials();

  const args = {
    ...creds,
    keys: cargoKey,
    keyType: 0, // cargoKey
    addHistoricalData: true,
    onlyTracking: false,
  };

  const [result] = await client.queryShipmentAsync(args);
  const outFlag = result?.QueryShipmentResultVO?.outFlag;

  if (outFlag !== "0") {
    return {
      success: false,
      events: [],
      errorMessage:
        result?.QueryShipmentResultVO?.errMessage || "Query failed",
    };
  }

  const shippingData =
    result?.QueryShipmentResultVO?.shippingDeliveryDetailVO;

  const events: TrackingEvent[] = [];
  if (shippingData?.invDocCargoVOArray) {
    const history = Array.isArray(shippingData.invDocCargoVOArray)
      ? shippingData.invDocCargoVOArray
      : [shippingData.invDocCargoVOArray];

    for (const entry of history) {
      events.push({
        date: entry.operationDate || "",
        description: entry.operationCode || "",
        location: entry.unitName || "",
      });
    }
  }

  return { success: true, events };
}

export async function cancelShipment(
  cargoKey: string
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = await getClient();
  const creds = getCredentials();

  const args = {
    ...creds,
    cargoKeys: cargoKey,
  };

  const [result] = await client.cancelShipmentAsync(args);
  const outFlag = result?.ShippingOrderResultVO?.outFlag;

  if (outFlag === "0") {
    return { success: true };
  }

  return {
    success: false,
    errorMessage:
      result?.ShippingOrderResultVO?.errMessage || "Cancel failed",
  };
}

export function getTrackingUrl(cargoKey: string): string {
  return `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encodeURIComponent(cargoKey)}`;
}
